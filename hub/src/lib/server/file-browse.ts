/**
 * Filesystem browser for the hub. Lists directory entries and reads
 * file contents, but ONLY within $HUB_STORAGE_DIR. Any path that
 * resolves outside that root is rejected with `out-of-root` — the
 * patron cannot read arbitrary files on Kepler through this API.
 *
 * Binary detection: read the first BIN_PROBE bytes; if more than
 * 5% are NUL or invalid UTF-8, mark binary. Text files are
 * returned as utf-8 strings; binary files return only metadata
 * plus a placeholder.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

const STORAGE_DIR =
  process.env['HUB_STORAGE_DIR'] ?? path.join(homedir(), 'webspinner-hub', 'storage');

const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB cap on inline content
const BIN_PROBE = 4096;

export interface FileEntry {
  readonly name: string;
  readonly kind: 'dir' | 'file';
  readonly size: number;
  readonly mtime: string;
  readonly mode: string;
}

export interface DirListing {
  readonly relPath: string;
  readonly entries: readonly FileEntry[];
}

export type BrowseError =
  | 'out-of-root'
  | 'not-found'
  | 'not-a-directory'
  | 'not-a-file'
  | 'too-large'
  | 'io';

export interface DirResult {
  readonly ok: true;
  readonly listing: DirListing;
}

export interface FileTextResult {
  readonly ok: true;
  readonly relPath: string;
  readonly size: number;
  readonly mtime: string;
  readonly binary: false;
  readonly content: string;
}

export interface FileBinaryResult {
  readonly ok: true;
  readonly relPath: string;
  readonly size: number;
  readonly mtime: string;
  readonly binary: true;
  readonly placeholder: string;
}

export type FileResult = FileTextResult | FileBinaryResult;

export type Result<T> = T | { readonly ok: false; readonly reason: BrowseError };

function resolveSafe(relPath: string): string | null {
  const cleaned = (relPath ?? '').replace(/^\/+/, '');
  const abs = path.resolve(STORAGE_DIR, cleaned);
  const rootWithSep = STORAGE_DIR.endsWith(path.sep) ? STORAGE_DIR : STORAGE_DIR + path.sep;
  if (abs !== STORAGE_DIR && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

export async function listDir(relPath: string): Promise<Result<DirResult>> {
  const abs = resolveSafe(relPath);
  if (abs === null) return { ok: false, reason: 'out-of-root' };
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
      mode: '0' + (cst.mode & 0o777).toString(8),
    });
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  );
  const rel = path.relative(STORAGE_DIR, abs) || '.';
  return { ok: true, listing: { relPath: rel, entries } };
}

/**
 * Decide if `buf` looks binary. Returns true if any NUL byte is
 * present in the probe window, or if >5% of bytes are outside the
 * common printable / whitespace ranges.
 */
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

export async function readFile(relPath: string): Promise<Result<FileResult>> {
  const abs = resolveSafe(relPath);
  if (abs === null) return { ok: false, reason: 'out-of-root' };
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not-a-file' };
  if (st.size > MAX_TEXT_BYTES) {
    return {
      ok: true,
      relPath: path.relative(STORAGE_DIR, abs),
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
      relPath: path.relative(STORAGE_DIR, abs),
      size: st.size,
      mtime: st.mtime.toISOString(),
      binary: true,
      placeholder: `(binary file — ${st.size} bytes)`,
    };
  }
  return {
    ok: true,
    relPath: path.relative(STORAGE_DIR, abs),
    size: st.size,
    mtime: st.mtime.toISOString(),
    binary: false,
    content: buf.toString('utf8'),
  };
}
