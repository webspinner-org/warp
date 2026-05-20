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

export interface TreeNode {
  readonly slug: string;
  readonly displayName: string;
  readonly kind: 'folder' | 'project' | 'published-webbase';
  readonly childCount?: number;
  readonly projectMeta?: ProjectMeta;
  readonly publishedMeta?: PublishedWebbaseMeta;
}

const STORAGE_DIR =
  process.env['HUB_STORAGE_DIR'] ?? path.join(homedir(), 'webspinner-hub', 'storage');

const ROOT_FOLDERS = [
  { slug: 'try-webspinner-projects', displayName: 'Try Webspinner Projects' },
  { slug: 'published-work', displayName: 'Published Work' },
] as const;

const SUB_FOLDERS: Record<string, { slug: string; displayName: string }[]> = {
  'try-webspinner-projects': [{ slug: 'webbase-app', displayName: 'Webbase App' }],
  'published-work': [{ slug: 'webbase-app', displayName: 'Webbase App' }],
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
      let count: number;
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

  // Try Webspinner Projects → Webbase Apps — list project directories.
  if (
    segments.length === 2 &&
    segments[0] === 'try-webspinner-projects' &&
    segments[1] === 'webbase-app'
  ) {
    const dir = path.join(STORAGE_DIR, first, 'webbase-app');
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
        projectMeta: meta,
      });
    }
    out.sort((a, b) =>
      (b.projectMeta?.updatedAt ?? '').localeCompare(a.projectMeta?.updatedAt ?? ''),
    );
    return out;
  }

  // Published Work → Webbase App — list published-webbase directories.
  if (segments.length === 2 && segments[0] === 'published-work' && segments[1] === 'webbase-app') {
    const dir = path.join(STORAGE_DIR, 'published-work', 'webbase-app');
    if (!(await dirExists(dir))) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const out: TreeNode[] = [];
    for (const e of dirs) {
      const metaPath = path.join(dir, e.name, 'meta.json');
      const meta = await safeReadJson<PublishedWebbaseMeta>(metaPath);
      if (!meta) continue;
      out.push({
        slug: e.name,
        displayName: meta.appName || e.name,
        kind: 'published-webbase',
        publishedMeta: meta,
      });
    }
    out.sort((a, b) =>
      (b.publishedMeta?.updatedAt ?? '').localeCompare(a.publishedMeta?.updatedAt ?? ''),
    );
    return out;
  }

  return [];
}

export async function getPublishedWebbaseMeta(
  shortCode: string,
): Promise<PublishedWebbaseMeta | null> {
  const metaPath = path.join(STORAGE_DIR, 'published-work', 'webbase-app', shortCode, 'meta.json');
  return safeReadJson<PublishedWebbaseMeta>(metaPath);
}

export async function getProjectMeta(sessionId: string): Promise<ProjectMeta | null> {
  const metaPath = path.join(
    STORAGE_DIR,
    'try-webspinner-projects',
    'webbase-app',
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
    'webbase-app',
    sessionId,
    'project.json',
  );
  return safeReadJson<ProjectSource>(srcPath);
}
