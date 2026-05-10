// Bootstrap Spool readers.
//
// A Spool is a registered data source a Spinner reads from. The
// canonical Weaver implements Spools as full WRAG (canon §4: query
// understanding → retrieval → re-ranking → context assembly). Today
// the bootstrap reader is `whole-file`: when a Spinner declares a Spool
// and asks for it, the entire source file is returned as a single
// passage. Sufficient for the canon (~30 KB) and DECISIONS / OPEN_QUESTIONS
// at current size. Replaced by chunked retrieval + re-ranking when the
// WRAG implementation lands.
//
// Spool registration is open work (`OPEN_QUESTIONS.md` —
// *Spool registry and per-Spool sensitivity classification*). Today the
// known Spools are wired statically here; the manifest declarations
// validate against this list.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SpoolName, SpoolPassage } from '@webspinner-foundation/sdk';

const WARP_DIR = resolve(process.env['WARP_REPO_DIR'] ?? join(process.cwd(), '..'));
const MANUSCRIPT_DIR = resolve(
  process.env['WARP_MANUSCRIPT_DIR'] ?? join(WARP_DIR, '..', 'ai-enclosure'),
);
const PABLO_LIBRARY_DIR = resolve(
  process.env['WARP_PABLO_LIBRARY_DIR'] ?? join(WARP_DIR, 'spinners', 'pablo', 'library'),
);

interface BootstrapSpool {
  readonly name: SpoolName;
  readonly displayName: string;
  readonly sensitivity: 'public' | 'personal' | 'confidential' | 'privileged';
  read(): Promise<readonly SpoolPassage[]>;
}

async function readWholeFile(absPath: string, source: string): Promise<readonly SpoolPassage[]> {
  try {
    const content = await readFile(absPath, 'utf8');
    return [{ source, content, score: 1 }];
  } catch {
    return [];
  }
}

async function readPabloLibrary(): Promise<readonly SpoolPassage[]> {
  try {
    const info = await stat(PABLO_LIBRARY_DIR);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }
  const entries = await readdir(PABLO_LIBRARY_DIR);
  const mdFiles = entries.filter((e) => e.endsWith('.md')).sort();
  const out: SpoolPassage[] = [];
  for (const file of mdFiles) {
    const content = await readFile(join(PABLO_LIBRARY_DIR, file), 'utf8').catch(() => '');
    if (content.length === 0) continue;
    out.push({ source: `library/${file}`, content, score: 1 });
  }
  return out;
}

async function readManuscriptDir(): Promise<readonly SpoolPassage[]> {
  try {
    const info = await stat(MANUSCRIPT_DIR);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }
  // Bootstrap: read just the chapter index if present, not the full
  // manuscript (would blow context). Real WRAG retrieves chunks.
  const out: SpoolPassage[] = [];
  for (const candidate of ['README.md', 'index.md', 'chapters/index.md']) {
    const passages = await readWholeFile(
      join(MANUSCRIPT_DIR, candidate),
      `manuscript:${candidate}`,
    );
    out.push(...passages);
  }
  return out;
}

const SPOOLS: ReadonlyMap<SpoolName, BootstrapSpool> = new Map<SpoolName, BootstrapSpool>([
  [
    '@webspinner-foundation/warp-canon' as SpoolName,
    {
      name: '@webspinner-foundation/warp-canon' as SpoolName,
      displayName: 'Warp Canon',
      sensitivity: 'public',
      read: () => readWholeFile(join(WARP_DIR, 'WARP-CANON.md'), 'WARP-CANON.md'),
    },
  ],
  [
    '@webspinner-foundation/warp-decisions' as SpoolName,
    {
      name: '@webspinner-foundation/warp-decisions' as SpoolName,
      displayName: 'Warp Decisions',
      sensitivity: 'confidential',
      read: () => readWholeFile(join(WARP_DIR, 'DECISIONS.md'), 'DECISIONS.md'),
    },
  ],
  [
    '@webspinner-foundation/warp-open-questions' as SpoolName,
    {
      name: '@webspinner-foundation/warp-open-questions' as SpoolName,
      displayName: 'Warp Open Questions',
      sensitivity: 'confidential',
      read: () => readWholeFile(join(WARP_DIR, 'OPEN_QUESTIONS.md'), 'OPEN_QUESTIONS.md'),
    },
  ],
  [
    '@webspinner-foundation/ai-enclosure' as SpoolName,
    {
      name: '@webspinner-foundation/ai-enclosure' as SpoolName,
      displayName: 'AI Enclosure (manuscript)',
      sensitivity: 'public',
      read: readManuscriptDir,
    },
  ],
  [
    '@webspinner-foundation/pablo-references' as SpoolName,
    {
      name: '@webspinner-foundation/pablo-references' as SpoolName,
      displayName: 'Pablo References',
      sensitivity: 'public',
      read: readPabloLibrary,
    },
  ],
]);

export function knownSpools(): readonly SpoolName[] {
  return [...SPOOLS.keys()];
}

export function spoolDisplayName(name: SpoolName): string | undefined {
  return SPOOLS.get(name)?.displayName;
}

export async function readSpool(name: SpoolName): Promise<readonly SpoolPassage[]> {
  const spool = SPOOLS.get(name);
  if (!spool) return [];
  return spool.read();
}
