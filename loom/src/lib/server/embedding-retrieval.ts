// Embedding retrieval pipeline — chunked grounding via the Kepler embeddings sidecar.
//
// Per WARP-CANON.md §4 (WRAG): query understanding → retrieval → re-ranking
// → context assembly → inference → grounding verification → response.
// This module implements the first half (chunk + embed + top-k cosine).
// Re-ranking with BGE-reranker (canon stage 3) is open work; the current
// MiniLM-L6-v2 dot-product top-k is sufficient for the canon's size and
// is the canon-faithful next step beyond whole-file spool dumps.
//
// The embeddings sidecar (sentence-transformers/all-MiniLM-L6-v2 on 127.0.0.1:11446) returns
// normalised 384-dim vectors, so cosine similarity == dot product.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { embed } from './kepler.js';

const WARP_DIR = resolve(process.env['WARP_REPO_DIR'] ?? join(process.cwd(), '..'));

interface ChunkRecord {
  /** Stable identifier rendered in citations: e.g. "WARP-CANON.md §11. Foundation Pledge". */
  readonly source: string;
  readonly filePath: string;
  readonly sectionTitle: string;
  readonly content: string;
  readonly embedding: readonly number[];
}

interface CorpusBucket {
  readonly sourceFile: string;
  readonly sourceLabel: string;
  readonly chunks: readonly ChunkRecord[];
  readonly embeddedAt: string;
}

// Module-level in-memory cache. Lazy-loaded on first retrieval; persists for
// the Loom process's lifetime. Restarting the Loom re-embeds. The corpus
// is small enough (canon + decisions + open-questions ≈ 80 KB total) that
// re-embed on restart is sub-second; persistence to PB is open work.
const CACHE: Map<string, CorpusBucket> = new Map();

const HEADING_RE = /^(#{1,3})\s+(.+)$/;

function chunkMarkdown(
  text: string,
  sourceLabel: string,
): readonly { sectionTitle: string; content: string }[] {
  const lines = text.split('\n');
  const chunks: { sectionTitle: string; content: string }[] = [];
  let currentTitle = sourceLabel;
  let currentBody: string[] = [];

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    // Treat H2 as primary chunk boundary; H3 stays inside its parent H2.
    if (m && m[1] && m[1].length === 2) {
      const body = currentBody.join('\n').trim();
      if (body) chunks.push({ sectionTitle: currentTitle, content: body });
      currentTitle = m[2]?.trim() ?? sourceLabel;
      currentBody = [line];
    } else {
      currentBody.push(line);
    }
  }
  const tail = currentBody.join('\n').trim();
  if (tail) chunks.push({ sectionTitle: currentTitle, content: tail });
  return chunks;
}

async function loadAndEmbed(filePath: string, sourceLabel: string): Promise<CorpusBucket> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return { sourceFile: filePath, sourceLabel, chunks: [], embeddedAt: new Date().toISOString() };
  }
  const raw = chunkMarkdown(text, sourceLabel);
  if (raw.length === 0) {
    return { sourceFile: filePath, sourceLabel, chunks: [], embeddedAt: new Date().toISOString() };
  }
  const result = await embed(raw.map((c) => c.content));
  const chunks: ChunkRecord[] = raw.map((c, i) => ({
    source: `${sourceLabel} — ${c.sectionTitle}`,
    filePath,
    sectionTitle: c.sectionTitle,
    content: c.content,
    embedding: result.vectors[i] ?? [],
  }));
  return { sourceFile: filePath, sourceLabel, chunks, embeddedAt: new Date().toISOString() };
}

async function getOrLoadBucket(filePath: string, sourceLabel: string): Promise<CorpusBucket> {
  let bucket = CACHE.get(filePath);
  if (!bucket) {
    bucket = await loadAndEmbed(filePath, sourceLabel);
    CACHE.set(filePath, bucket);
  }
  return bucket;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  // The sidecar emits L2-normalised vectors; cosine = dot product.
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    if (av !== undefined && bv !== undefined) dot += av * bv;
  }
  return dot;
}

export interface RetrievedPassage {
  readonly source: string;
  readonly content: string;
  readonly score: number;
  readonly rank: number;
}

export interface RetrievalRequest {
  readonly question: string;
  readonly sourceFiles: readonly { readonly path: string; readonly label: string }[];
  readonly topK?: number;
}

export interface RetrievalResult {
  readonly passages: readonly RetrievedPassage[];
  readonly totalChunks: number;
  readonly model: string;
  readonly elapsedMs: number;
  readonly cacheHit: boolean;
}

const SOURCE_BY_SPOOL: Readonly<Record<string, { readonly path: string; readonly label: string }>> = {
  '@webspinner-foundation/warp-canon': {
    path: join(WARP_DIR, 'WARP-CANON.md'),
    label: 'WARP-CANON.md',
  },
  '@webspinner-foundation/warp-decisions': {
    path: join(WARP_DIR, 'DECISIONS.md'),
    label: 'DECISIONS.md',
  },
  '@webspinner-foundation/warp-open-questions': {
    path: join(WARP_DIR, 'OPEN_QUESTIONS.md'),
    label: 'OPEN_QUESTIONS.md',
  },
};

export function spoolToSourceFile(
  spoolName: string,
): { readonly path: string; readonly label: string } | undefined {
  return SOURCE_BY_SPOOL[spoolName];
}

export async function retrieveTopK(req: RetrievalRequest): Promise<RetrievalResult> {
  const t0 = Date.now();
  const allCachedBefore = req.sourceFiles.every((s) => CACHE.has(s.path));

  const buckets = await Promise.all(
    req.sourceFiles.map((s) => getOrLoadBucket(s.path, s.label)),
  );
  const allChunks: ChunkRecord[] = buckets.flatMap((b) => [...b.chunks]);

  if (allChunks.length === 0) {
    return {
      passages: [],
      totalChunks: 0,
      model: 'sentence-transformers/all-MiniLM-L6-v2',
      elapsedMs: Date.now() - t0,
      cacheHit: allCachedBefore,
    };
  }

  const qEmbed = await embed([req.question]);
  const qVec = qEmbed.vectors[0] ?? [];

  const scored = allChunks.map((c) => ({ chunk: c, score: cosine(qVec, c.embedding) }));
  scored.sort((a, b) => b.score - a.score);

  const topK = req.topK ?? 8;
  const passages: RetrievedPassage[] = scored.slice(0, topK).map((s, i) => ({
    source: s.chunk.source,
    content: s.chunk.content,
    score: s.score,
    rank: i + 1,
  }));

  return {
    passages,
    totalChunks: allChunks.length,
    model: qEmbed.model,
    elapsedMs: Date.now() - t0,
    cacheHit: allCachedBefore,
  };
}

export function corpusStats(): { source: string; chunks: number; bytes: number; embeddedAt: string }[] {
  const out: { source: string; chunks: number; bytes: number; embeddedAt: string }[] = [];
  for (const bucket of CACHE.values()) {
    out.push({
      source: bucket.sourceLabel,
      chunks: bucket.chunks.length,
      bytes: bucket.chunks.reduce((acc, c) => acc + c.content.length, 0),
      embeddedAt: bucket.embeddedAt,
    });
  }
  return out;
}
