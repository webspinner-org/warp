/**
 * Foundation-precedent retrieval — first leg of the v2 propose chain.
 *
 * Given a patron sentence, return the top-K Foundation precedents
 * (full schemaDraft + branding) ranked by cosine similarity against
 * BGE-M3 embeddings.
 *
 * The precedent corpus and its embedding index live in the warp
 * repo at ~/warp/foundation-precedents/:
 *   - <slug>/schema.json    — the full ScreensDraft + branding
 *   - <slug>/narrative.md   — patron-style sentence + design rationale
 *   - .index.json           — { slug → { vector, sentence, appName, domain } }
 *
 * The index is rebuilt by tools/precedents-index.py whenever the
 * library changes; the result commits to the repo. Production reads
 * the committed index — no per-Cell re-embedding needed.
 *
 * The embedding service is at WARP_EMBEDDINGS_URL (default
 * http://127.0.0.1:8101). The query call costs ~50-100ms; the
 * scoring math is microseconds (1024-dim dot products over 15-50
 * vectors).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';

// Note: NOT WARP_EMBEDDINGS_URL — that env var already points at an
// older MiniLM service used by spool retrieval. The Foundation BGE-M3
// service is its own thing on its own port; use a dedicated env var.
const EMBEDDINGS_URL = process.env['WARP_FOUNDATION_EMBEDDINGS_URL'] ?? 'http://127.0.0.1:8101';
const PRECEDENTS_DIR =
  process.env['WARP_PRECEDENTS_DIR'] ?? path.join(homedir(), 'warp', 'foundation-precedents');
const INDEX_PATH = path.join(PRECEDENTS_DIR, '.index.json');

export interface PrecedentRow {
  readonly slug: string;
  readonly dim: number;
  readonly vector: readonly number[];
  readonly sentence: string;
  readonly appName: string;
  readonly domain: string;
}

export interface RetrievedPrecedent {
  readonly slug: string;
  readonly score: number;
  readonly sentence: string;
  readonly appName: string;
  readonly domain: string;
  readonly schema: Record<string, unknown>;
  readonly narrative: string;
}

let cachedIndex: Record<string, PrecedentRow> | null = null;
const cachedSchemas: Record<string, { schema: Record<string, unknown>; narrative: string }> = {};

async function loadIndex(): Promise<Record<string, PrecedentRow>> {
  if (cachedIndex) return cachedIndex;
  try {
    const text = await fs.readFile(INDEX_PATH, 'utf8');
    cachedIndex = JSON.parse(text) as Record<string, PrecedentRow>;
    return cachedIndex;
  } catch (e) {
    throw new Error(`precedent index not found at ${INDEX_PATH} — run tools/precedents-index.py`, {
      cause: e,
    });
  }
}

async function loadSchemaAndNarrative(slug: string): Promise<{
  schema: Record<string, unknown>;
  narrative: string;
}> {
  if (cachedSchemas[slug]) return cachedSchemas[slug];
  const dir = path.join(PRECEDENTS_DIR, slug);
  const [schemaText, narrative] = await Promise.all([
    fs.readFile(path.join(dir, 'schema.json'), 'utf8'),
    fs.readFile(path.join(dir, 'narrative.md'), 'utf8'),
  ]);
  const cached = { schema: JSON.parse(schemaText), narrative };
  cachedSchemas[slug] = cached;
  return cached;
}

async function embedQuery(text: string, fetchFn: typeof fetch): Promise<readonly number[]> {
  const res = await fetchFn(`${EMBEDDINGS_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: [text] }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '<unreadable>');
    throw new Error(`embeddings service: HTTP ${res.status} body=${txt.slice(0, 200)}`);
  }
  const raw = await res.text();
  let body: { embeddings?: number[][]; dim?: number };
  try {
    body = JSON.parse(raw) as { embeddings?: number[][]; dim?: number };
  } catch (e) {
    throw new Error(
      `embeddings service: invalid JSON body=${raw.slice(0, 200)} err=${(e as Error).message}`,
      { cause: e },
    );
  }
  if (!body.embeddings || !Array.isArray(body.embeddings) || !body.embeddings[0]) {
    throw new Error(
      `embeddings service: empty response keys=${Object.keys(body).join(',')} body=${raw.slice(0, 200)}`,
    );
  }
  return body.embeddings[0];
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Retrieve the top-K Foundation precedents for a patron sentence.
 * Returns precedents sorted by descending cosine similarity. Each
 * carries its full schemaDraft + branding so the caller can splice
 * them straight into the LLM prompt.
 *
 * The fetchFn parameter is forwarded for testability and so this
 * runs inside SvelteKit's load() where event.fetch is the
 * canonical fetch.
 */
export async function retrievePrecedents(
  sentence: string,
  k: number,
  fetchFn: typeof fetch = fetch,
): Promise<RetrievedPrecedent[]> {
  if (!sentence || sentence.trim().length === 0) return [];
  if (k <= 0) return [];

  const index = await loadIndex();
  const queryVec = await embedQuery(sentence, fetchFn);

  const scored: { row: PrecedentRow; score: number }[] = [];
  for (const row of Object.values(index)) {
    scored.push({ row, score: cosine(queryVec, row.vector) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);

  const out: RetrievedPrecedent[] = [];
  for (const { row, score } of top) {
    const { schema, narrative } = await loadSchemaAndNarrative(row.slug);
    out.push({
      slug: row.slug,
      score,
      sentence: row.sentence,
      appName: row.appName,
      domain: row.domain,
      schema,
      narrative,
    });
  }
  return out;
}

/**
 * Debug-friendly variant: returns ALL precedents scored, sorted.
 * Useful for the admin Operations log or for tuning the retrieval
 * threshold. Same cost as retrievePrecedents(k=all).
 */
export async function retrieveAll(
  sentence: string,
  fetchFn: typeof fetch = fetch,
): Promise<RetrievedPrecedent[]> {
  const index = await loadIndex();
  return retrievePrecedents(sentence, Object.keys(index).length, fetchFn);
}
