/**
 * Patron-side file browser. Lets a patron in try see the on-disk
 * artifacts for their own work — same files hub shows under Try
 * Webspinner Projects / Published Work, but scoped to ONLY their
 * own items.
 *
 * Authz model:
 *   - Caller supplies (kind, identifier) — either ('source',
 *     sessionId) or ('published', shortCode).
 *   - Caller's identity is the warp_hub cookie email.
 *   - We verify the identifier belongs to the caller (matching
 *     wp_spinner_sessions.actor_email or wp_app_packages.sender_email).
 *   - We resolve the matching on-disk directory by scanning the
 *     known catalog roots and matching the slug suffix.
 *   - All subsequent file operations are scoped INSIDE that directory.
 *     Any path that would escape is rejected with `out-of-root`.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

const STORAGE_DIR =
  process.env['HUB_STORAGE_DIR'] ?? path.join(homedir(), 'webspinner-hub', 'storage');
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB
const BIN_PROBE = 4096;

export type ItemKind = 'source' | 'published';

export interface FileEntry {
  readonly name: string;
  readonly kind: 'dir' | 'file';
  readonly size: number;
  readonly mtime: string;
}

export interface DirListing {
  readonly relPath: string;
  readonly entries: readonly FileEntry[];
}

export type BrowseError =
  | 'item-not-found'
  | 'not-owner'
  | 'out-of-root'
  | 'not-found'
  | 'not-a-directory'
  | 'not-a-file'
  | 'io';

export type DirResult =
  | { readonly ok: true; readonly listing: DirListing; readonly itemRoot: string }
  | { readonly ok: false; readonly reason: BrowseError };

export type FileResult =
  | {
      readonly ok: true;
      readonly relPath: string;
      readonly size: number;
      readonly mtime: string;
      readonly binary: boolean;
      readonly content?: string;
      readonly placeholder?: string;
    }
  | { readonly ok: false; readonly reason: BrowseError };

/**
 * Locate the on-disk directory for a (kind, identifier) by scanning
 * the known catalog roots. Returns the directory's absolute path,
 * or null if no matching directory exists.
 *
 * Slug patterns produced by hub-storage-write.ts:
 *   source    → <slug>--<sessionId-first-8>
 *   published → <slug>--v<version>--<shortCode>
 *
 * We search by suffix match on the identifier (8 chars for source,
 * full shortCode for published).
 */
async function findItemDir(kind: ItemKind, identifier: string): Promise<string | null> {
  const subroot =
    kind === 'source'
      ? path.join(STORAGE_DIR, 'try-webspinner-projects', 'webbase-app')
      : path.join(STORAGE_DIR, 'published-work', 'webbase-app');
  let entries: string[];
  try {
    entries = await fs.readdir(subroot);
  } catch {
    return null;
  }
  // Source ID suffix is the first 8 chars of the demo-<uuid>.
  const suffix = kind === 'source' ? identifier.replace(/^demo-/, '').slice(0, 8) : identifier;
  if (!suffix) return null;
  for (const e of entries) {
    if (kind === 'source' && e.endsWith('--' + suffix)) {
      return path.join(subroot, e);
    }
    if (kind === 'published' && e.includes('--' + suffix)) {
      return path.join(subroot, e);
    }
  }
  return null;
}

function resolveSafeWithin(itemRoot: string, subpath: string): string | null {
  const cleaned = (subpath ?? '').replace(/^\/+/, '');
  const abs = path.resolve(itemRoot, cleaned);
  const withSep = itemRoot.endsWith(path.sep) ? itemRoot : itemRoot + path.sep;
  if (abs !== itemRoot && !abs.startsWith(withSep)) return null;
  return abs;
}

export async function listItemDir(
  kind: ItemKind,
  identifier: string,
  subpath: string,
): Promise<DirResult> {
  const itemRoot = await findItemDir(kind, identifier);
  if (!itemRoot) return { ok: false, reason: 'item-not-found' };

  const abs = resolveSafeWithin(itemRoot, subpath);
  if (!abs) return { ok: false, reason: 'out-of-root' };

  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  if (!st.isDirectory()) return { ok: false, reason: 'not-a-directory' };

  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const e of dirents) {
    if (e.name.startsWith('.')) continue;
    const child = path.join(abs, e.name);
    const cst = await fs.stat(child).catch(() => null);
    if (!cst) continue;
    entries.push({
      name: e.name,
      kind: e.isDirectory() ? 'dir' : 'file',
      size: cst.size,
      mtime: cst.mtime.toISOString(),
    });
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  );

  return {
    ok: true,
    listing: { relPath: path.relative(itemRoot, abs) || '.', entries },
    itemRoot,
  };
}

function looksBinary(buf: Buffer): boolean {
  const probe = buf.length > BIN_PROBE ? buf.subarray(0, BIN_PROBE) : buf;
  if (probe.includes(0)) return true;
  let nonText = 0;
  for (const b of probe) {
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) nonText++;
  }
  return probe.length > 0 && nonText / probe.length > 0.05;
}

export async function readItemFile(
  kind: ItemKind,
  identifier: string,
  subpath: string,
): Promise<FileResult> {
  const itemRoot = await findItemDir(kind, identifier);
  if (!itemRoot) return { ok: false, reason: 'item-not-found' };

  const abs = resolveSafeWithin(itemRoot, subpath);
  if (!abs) return { ok: false, reason: 'out-of-root' };

  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not-a-file' };

  const relPath = path.relative(itemRoot, abs);

  if (st.size > MAX_TEXT_BYTES) {
    return {
      ok: true,
      relPath,
      size: st.size,
      mtime: st.mtime.toISOString(),
      binary: true,
      placeholder: `(file is ${st.size} bytes — too large to preview inline)`,
    };
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return { ok: false, reason: 'io' };
  }
  if (looksBinary(buf)) {
    return {
      ok: true,
      relPath,
      size: st.size,
      mtime: st.mtime.toISOString(),
      binary: true,
      placeholder: `(binary file — ${st.size} bytes)`,
    };
  }
  return {
    ok: true,
    relPath,
    size: st.size,
    mtime: st.mtime.toISOString(),
    binary: false,
    content: buf.toString('utf8'),
  };
}
