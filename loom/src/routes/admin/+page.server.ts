// /admin status — the live landing. Surfaces what the Cell IS doing
// (versions, Spinner roster, recent activity) instead of abstract config.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { listSpinners } from '$lib/server/spinners.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  ensureJournalCollection,
  listRecent as listRecentJournalEntries,
  countEntries as countJournalEntries,
} from '$lib/server/journal.js';
import type { PageServerLoad } from './$types.js';

const WARP_REPO_DIR = resolvePath(process.env['WARP_REPO_DIR'] ?? join(process.cwd(), '..'));

interface RecentCommit {
  readonly hash: string;
  readonly subject: string;
  readonly timestamp: string;
}

interface RecentEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: string;
  readonly title: string;
}

function gitLines(args: readonly string[]): readonly string[] {
  try {
    const out = execFileSync('git', [...args], {
      cwd: WARP_REPO_DIR,
      encoding: 'utf8',
      timeout: 3_000,
    });
    return out.split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

async function readLoomVersion(): Promise<string> {
  try {
    const text = await readFile(join(WARP_REPO_DIR, 'loom', 'package.json'), 'utf8');
    const pkg = JSON.parse(text) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export const load: PageServerLoad = async ({ fetch, parent }) => {
  const layoutData = await parent();

  const version = await readLoomVersion();
  const headLines = gitLines(['log', '-1', '--format=%h %ai']);
  const headParts = (headLines[0] ?? '').split(' ');
  const head = {
    hash: headParts[0] ?? '?',
    timestamp: headParts.slice(1).join(' ') || '?',
  };

  // Latest tag (semantic version of the deployed state).
  const tags = gitLines(['describe', '--tags', '--abbrev=0']);
  const latestTag = tags[0] ?? '';

  // Last 6 commits — show on landing as "what shipped".
  const commitLines = gitLines(['log', '-6', '--format=%h|%s|%ai']);
  const recentCommits: RecentCommit[] = commitLines.map((line) => {
    const [hash, subject, ts] = line.split('|');
    return { hash: hash ?? '?', subject: subject ?? '?', timestamp: ts ?? '?' };
  });

  // Spinner roster from disk.
  let spinnerCount = 0;
  let spinnerSummaries: Array<{ slug: string; displayName: string; capabilityCount: number }> = [];
  try {
    const spinners = await listSpinners();
    spinnerCount = spinners.length;
    spinnerSummaries = spinners.map((s) => ({
      slug: s.slug,
      displayName: s.manifest.displayName,
      capabilityCount: s.manifest.capabilities.length,
    }));
  } catch {
    // tolerate — page renders without Spinner roster
  }

  // Journal: ensure collection, count, fetch the last few entries.
  let journalTotal = 0;
  let journalRecent: RecentEntry[] = [];
  try {
    const pbToken = await loomPbToken(fetch);
    if (pbToken) {
      await ensureJournalCollection(fetch, pbToken);
      const count = await countJournalEntries(fetch, pbToken);
      if (count.ok) journalTotal = count.value;
      const recent = await listRecentJournalEntries(fetch, pbToken, { horizonDays: 30 });
      if (recent.ok) {
        journalRecent = recent.value.slice(0, 5).map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          kind: e.kind,
          title: e.title,
        }));
      }
    }
  } catch {
    // tolerate
  }

  return {
    user: layoutData.user,
    version,
    head,
    latestTag,
    recentCommits,
    spinnerCount,
    spinnerSummaries,
    journal: {
      total: journalTotal,
      recent: journalRecent,
    },
    loom: {
      uptimeSec: process.uptime(),
      uptimeLabel: fmtUptime(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
  };
};
