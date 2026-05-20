/**
 * Side-write a Webbase project (work-in-process — the source the
 * patron is authoring) into the Webspinner Hub's storage tree on
 * the same Kepler filesystem. Called when a Database Application
 * Spinner builds a session into a wp_database_applications row,
 * so the hub catalogs the *source* the patron can come back to
 * and resume.
 *
 * Publish artifacts (.webbase bundles) are a separate concern and
 * land elsewhere in the hub — not here.
 *
 * Layout (mirrors hub/src/lib/server/hub-storage.ts):
 *   $HUB_STORAGE_DIR/try-webspinner-projects/webbase-apps/<sessionId>/
 *     project.json   — design + schema (the patron's source)
 *     meta.json      — display metadata (name, status, resume url, ...)
 *
 * Failures (path missing, EACCES, etc.) are logged to stderr and
 * swallowed — the side-write must never break the patron's build.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

export type ProjectStatus = 'proposed' | 'refining' | 'ready' | 'built';

export interface ProjectMeta {
  readonly sessionId: string;
  readonly appName: string;
  readonly domain: string;
  readonly patronSentence: string;
  readonly status: ProjectStatus;
  readonly appId?: string;
  readonly entityCount?: number;
  readonly screenCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly builtAt?: string;
  readonly resumeUrl: string;
}

export interface ProjectSource {
  readonly screensDraft?: unknown;
  readonly branding?: unknown;
  readonly entities?: readonly unknown[];
}

function storageRoot(): string {
  return process.env['HUB_STORAGE_DIR'] ?? path.join(homedir(), 'webspinner-hub', 'storage');
}

/**
 * Slugify a human name for use as a filesystem-safe descriptive
 * prefix. Lowercases, replaces non-alphanumeric runs with `-`,
 * trims to 48 chars. Empty/whitespace names map to a stable
 * fallback so the cryptic id appendage stays unique.
 */
export function slugify(name: string, fallback = 'unnamed-webbase'): string {
  const cleaned = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Extract the 8-hex compact ID from a demo session id like
 * `demo-055039fa-8efa-47a2-bef3-a7c7bcb5822a` → `055039fa`. Anything
 * unexpected falls through to the first 8 chars.
 */
export function shortSessionSuffix(sessionId: string): string {
  const m = sessionId.match(/^demo-([0-9a-f]{8})/i);
  if (m) return m[1]!;
  return sessionId.replace(/[^a-z0-9]/gi, '').slice(0, 8);
}

export function projectDirName(appName: string, sessionId: string): string {
  return `${slugify(appName)}--${shortSessionSuffix(sessionId)}`;
}

export function publishedDirName(appName: string, version: number, shortCode: string): string {
  return `${slugify(appName)}--v${version}--${shortCode}`;
}

function dirForSession(meta: { sessionId: string; appName: string }): string {
  return path.join(
    storageRoot(),
    'try-webspinner-projects',
    'webbase-app',
    projectDirName(meta.appName, meta.sessionId),
  );
}

export async function writeProjectToHub(input: {
  meta: ProjectMeta;
  source: ProjectSource;
}): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  try {
    const dir = dirForSession({ sessionId: input.meta.sessionId, appName: input.meta.appName });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'project.json'),
      JSON.stringify(input.source, null, 2),
      'utf8',
    );
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(input.meta, null, 2), 'utf8');
    return { ok: true, path: dir };
  } catch (err) {
    const reason = (err as Error).message;
    process.stderr.write(`[hub-storage-write] failed for ${input.meta.sessionId}: ${reason}\n`);
    return { ok: false, reason };
  }
}

/* ──────────────────────────────────────────────────────────────
 * Published Webbase — publish-time artifact.
 *
 * Lives under $HUB_STORAGE_DIR/published-work/webbase-app/<shortCode>/
 * Catalogs every patron Publish. Distinct from work-in-process
 * projects (those live under try-webspinner-projects/webbase-apps).
 * ────────────────────────────────────────────────────────────── */

export interface PublishedWebbaseMeta {
  readonly shortCode: string;
  readonly appName: string;
  readonly domain: string;
  readonly version: number;
  readonly senderEmail: string;
  readonly cellName: string;
  readonly cellKeyFingerprint: string;
  readonly originAppId: string;
  readonly patronSentence: string;
  readonly hasPassphrase: boolean;
  readonly openUrl: string;
  readonly installCount: number;
  readonly maxInstalls: number;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function dirForPublished(input: { shortCode: string; appName: string; version: number }): string {
  return path.join(
    storageRoot(),
    'published-work',
    'webbase-app',
    publishedDirName(input.appName, input.version, input.shortCode),
  );
}

export async function writePublishedWebbaseToHub(input: {
  meta: PublishedWebbaseMeta;
  bundle: unknown;
}): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  try {
    const dir = dirForPublished({
      shortCode: input.meta.shortCode,
      appName: input.meta.appName,
      version: input.meta.version,
    });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'webbase.json'),
      JSON.stringify(input.bundle, null, 2),
      'utf8',
    );
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(input.meta, null, 2), 'utf8');
    return { ok: true, path: dir };
  } catch (err) {
    const reason = (err as Error).message;
    process.stderr.write(
      `[hub-storage-write] published failed for ${input.meta.shortCode}: ${reason}\n`,
    );
    return { ok: false, reason };
  }
}
