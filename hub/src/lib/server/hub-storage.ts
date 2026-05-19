/**
 * Hub storage — filesystem tree of artifacts the hub catalogs.
 *
 * Layout under `$HUB_STORAGE_DIR` (default `~/webspinner-hub/storage`):
 *
 *   try-webspinner-projects/
 *     webbase-apps/
 *       <sessionId>/
 *         project.json   — design + schema (the patron's source)
 *         meta.json      — display metadata (name, status, resume url, ...)
 *
 * "Webbase Apps" here = work-in-process projects, NOT publish
 * artifacts. The session id keys the project so the patron can be
 * sent back to /?resume=<sessionId> on try.webspinner.ai to keep
 * working. Publish artifacts (.webbase bundles) catalog separately.
 *
 * The hub reads this tree directly off disk on each request. Writes
 * come from the demo Loom's `createApp` path (which side-writes
 * alongside the wp_database_applications row). Future producers
 * land under sibling subtrees.
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

export interface TreeNode {
  readonly slug: string;
  readonly displayName: string;
  readonly kind: 'folder' | 'project';
  readonly childCount?: number;
  readonly meta?: ProjectMeta;
}

const STORAGE_DIR =
  process.env['HUB_STORAGE_DIR'] ?? path.join(homedir(), 'webspinner-hub', 'storage');

const ROOT_FOLDERS = [
  { slug: 'try-webspinner-projects', displayName: 'Try Webspinner Projects' },
] as const;

const SUB_FOLDERS: Record<string, { slug: string; displayName: string }[]> = {
  'try-webspinner-projects': [{ slug: 'webbase-apps', displayName: 'Webbase Apps' }],
};

export function storageDir(): string {
  return STORAGE_DIR;
}

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function listTreeAt(segments: readonly string[]): Promise<TreeNode[]> {
  if (segments.length === 0) {
    return ROOT_FOLDERS.map((f) => ({
      slug: f.slug,
      displayName: f.displayName,
      kind: 'folder' as const,
      childCount: SUB_FOLDERS[f.slug]?.length ?? 0,
    }));
  }
  const first = segments[0]!;
  const sub = SUB_FOLDERS[first];
  if (!sub) return [];

  if (segments.length === 1) {
    const out: TreeNode[] = [];
    for (const s of sub) {
      const dir = path.join(STORAGE_DIR, first, s.slug);
      let count = 0;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        count = entries.filter((e) => e.isDirectory()).length;
      } catch {
        count = 0;
      }
      out.push({ slug: s.slug, displayName: s.displayName, kind: 'folder', childCount: count });
    }
    return out;
  }

  // Webbase Apps — list project directories.
  if (segments.length === 2 && segments[1] === 'webbase-apps') {
    const dir = path.join(STORAGE_DIR, first, 'webbase-apps');
    if (!(await dirExists(dir))) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const out: TreeNode[] = [];
    for (const e of dirs) {
      const metaPath = path.join(dir, e.name, 'meta.json');
      const meta = await safeReadJson<ProjectMeta>(metaPath);
      if (!meta) continue;
      out.push({
        slug: e.name,
        displayName: meta.appName || e.name,
        kind: 'project',
        meta,
      });
    }
    out.sort((a, b) => (b.meta?.updatedAt ?? '').localeCompare(a.meta?.updatedAt ?? ''));
    return out;
  }

  return [];
}

export async function getProjectMeta(sessionId: string): Promise<ProjectMeta | null> {
  const metaPath = path.join(
    STORAGE_DIR,
    'try-webspinner-projects',
    'webbase-apps',
    sessionId,
    'meta.json',
  );
  return safeReadJson<ProjectMeta>(metaPath);
}

export interface ProjectSource {
  readonly screensDraft?: unknown;
  readonly branding?: unknown;
  readonly entities?: readonly unknown[];
}

export async function readProjectSource(sessionId: string): Promise<ProjectSource | null> {
  const srcPath = path.join(
    STORAGE_DIR,
    'try-webspinner-projects',
    'webbase-apps',
    sessionId,
    'project.json',
  );
  return safeReadJson<ProjectSource>(srcPath);
}
