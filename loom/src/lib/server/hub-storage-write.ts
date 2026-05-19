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

function dirForSession(sessionId: string): string {
  return path.join(storageRoot(), 'try-webspinner-projects', 'webbase-apps', sessionId);
}

export async function writeProjectToHub(input: {
  meta: ProjectMeta;
  source: ProjectSource;
}): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  try {
    const dir = dirForSession(input.meta.sessionId);
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
