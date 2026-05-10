// Wizard's Journal storage — PocketBase collection `wp_journal_entries`.
//
// Entries are append-only, embedded at write time via the Cell's MiniLM
// sidecar, and ranked at recall time by cosine similarity against the
// stored 384-dim float vectors. The journal does not edit, delete, or
// summarise; those are higher-order policies the Spinner enforces.

import { embed } from './kepler.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_journal_entries';

export type EntryKind = 'action' | 'decision' | 'problem' | 'learning' | 'note';

export interface JournalEntry {
  readonly id: string;
  readonly created: string;
  readonly updated: string;
  readonly timestamp: string;
  readonly actor_id: string;
  readonly actor_email: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly related_spinners: readonly string[];
  readonly public: boolean;
  readonly embedding: readonly number[];
}

export type JournalError =
  | { readonly kind: 'backend'; readonly status: number; readonly body: string }
  | { readonly kind: 'embed-failed'; readonly message: string };

export type JournalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: JournalError };

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

export async function ensureJournalCollection(
  fetchFn: typeof fetch,
  pbToken: string,
): Promise<JournalResult<void>> {
  const head = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}`, {
    headers: authHeaders(pbToken),
  });
  if (head.ok) return { ok: true, value: undefined };
  if (head.status !== 404) {
    return { ok: false, error: { kind: 'backend', status: head.status, body: await head.text() } };
  }
  const create = await fetchFn(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: authHeaders(pbToken),
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'timestamp', type: 'text', required: true, max: 32 },
        { name: 'actor_id', type: 'text', required: true, max: 64 },
        { name: 'actor_email', type: 'text', required: false, max: 254 },
        { name: 'kind', type: 'text', required: true, max: 16 },
        { name: 'title', type: 'text', required: true, max: 220 },
        { name: 'body', type: 'text', required: true, max: 12000 },
        { name: 'tags', type: 'json', required: false, maxSize: 4096 },
        { name: 'related_spinners', type: 'json', required: false, maxSize: 4096 },
        { name: 'public', type: 'bool', required: false },
        { name: 'embedding', type: 'json', required: false, maxSize: 16384 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE INDEX idx_${COLLECTION}_timestamp ON ${COLLECTION} (timestamp)`,
        `CREATE INDEX idx_${COLLECTION}_kind ON ${COLLECTION} (kind)`,
        `CREATE INDEX idx_${COLLECTION}_actor ON ${COLLECTION} (actor_id)`,
      ],
    }),
  });
  if (!create.ok) {
    return { ok: false, error: { kind: 'backend', status: create.status, body: await create.text() } };
  }
  return { ok: true, value: undefined };
}

export interface CreateEntryRequest {
  readonly actorEmail: string;
  readonly actorId: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly body: string;
  readonly tags?: readonly string[];
  readonly relatedSpinners?: readonly string[];
  readonly publicFlag?: boolean;
  /** Override timestamp (ISO). Defaults to now. */
  readonly timestamp?: string;
}

export async function createEntry(
  fetchFn: typeof fetch,
  pbToken: string,
  req: CreateEntryRequest,
): Promise<JournalResult<JournalEntry>> {
  let embedding: readonly number[];
  try {
    const text = `${req.title}\n\n${req.body}`;
    const result = await embed([text]);
    embedding = result.vectors[0] ?? [];
  } catch (e) {
    return {
      ok: false,
      error: { kind: 'embed-failed', message: e instanceof Error ? e.message : String(e) },
    };
  }

  const payload = {
    timestamp: req.timestamp ?? new Date().toISOString(),
    actor_id: req.actorId,
    actor_email: req.actorEmail,
    kind: req.kind,
    title: req.title,
    body: req.body,
    tags: req.tags ?? [],
    related_spinners: req.relatedSpinners ?? [],
    public: req.publicFlag ?? false,
    embedding,
  };

  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(pbToken),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    return { ok: false, error: { kind: 'backend', status: res.status, body: await res.text() } };
  }
  const row = (await res.json()) as JournalEntry;
  return { ok: true, value: row };
}

export interface RecallRequest {
  readonly query: string;
  readonly since?: string;
  readonly limit?: number;
  readonly kind?: EntryKind;
  readonly tag?: string;
}

export interface RecallHit {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly score: number;
}

export interface RecallReply {
  readonly entries: readonly RecallHit[];
  readonly totalScanned: number;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  // Embeddings are L2-normalised at the sidecar, so cosine == dot product.
  return dot;
}

export async function recallEntries(
  fetchFn: typeof fetch,
  pbToken: string,
  req: RecallRequest,
): Promise<JournalResult<RecallReply>> {
  let qVec: readonly number[];
  try {
    const result = await embed([req.query]);
    qVec = result.vectors[0] ?? [];
  } catch (e) {
    return {
      ok: false,
      error: { kind: 'embed-failed', message: e instanceof Error ? e.message : String(e) },
    };
  }

  const filter: string[] = [];
  if (req.since) filter.push(`timestamp >= ${JSON.stringify(req.since)}`);
  if (req.kind) filter.push(`kind = ${JSON.stringify(req.kind)}`);
  // Tag is JSON; PB filter on json arrays is limited — we filter client-side after fetch.

  const params = new URLSearchParams();
  params.set('perPage', '500');
  params.set('sort', '-timestamp');
  if (filter.length > 0) params.set('filter', filter.join(' && '));

  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records?${params.toString()}`, {
    headers: authHeaders(pbToken),
  });
  if (!res.ok) {
    return { ok: false, error: { kind: 'backend', status: res.status, body: await res.text() } };
  }
  const body = (await res.json()) as { items: readonly JournalEntry[] };
  let rows = body.items;

  if (req.tag) {
    rows = rows.filter((r) => Array.isArray(r.tags) && r.tags.includes(req.tag as string));
  }

  const limit = Math.max(1, Math.min(50, req.limit ?? 10));
  const scored = rows
    .map((r) => ({ row: r, score: cosine(qVec, r.embedding ?? []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    ok: true,
    value: {
      totalScanned: rows.length,
      entries: scored.map(({ row, score }) => ({
        id: row.id,
        timestamp: row.timestamp,
        kind: row.kind,
        title: row.title,
        body: row.body,
        tags: row.tags ?? [],
        score,
      })),
    },
  };
}

export interface ListRecentRequest {
  readonly horizonDays: number;
  readonly kind?: EntryKind;
}

/** List entries created within the horizon window, newest first. */
export async function listRecent(
  fetchFn: typeof fetch,
  pbToken: string,
  req: ListRecentRequest,
): Promise<JournalResult<readonly JournalEntry[]>> {
  const since = new Date(Date.now() - req.horizonDays * 24 * 60 * 60 * 1000).toISOString();
  const filter: string[] = [`timestamp >= ${JSON.stringify(since)}`];
  if (req.kind) filter.push(`kind = ${JSON.stringify(req.kind)}`);

  const params = new URLSearchParams();
  params.set('perPage', '200');
  params.set('sort', '-timestamp');
  params.set('filter', filter.join(' && '));

  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records?${params.toString()}`, {
    headers: authHeaders(pbToken),
  });
  if (!res.ok) {
    return { ok: false, error: { kind: 'backend', status: res.status, body: await res.text() } };
  }
  const body = (await res.json()) as { items: readonly JournalEntry[] };
  return { ok: true, value: body.items };
}

export async function countEntries(
  fetchFn: typeof fetch,
  pbToken: string,
): Promise<JournalResult<number>> {
  const params = new URLSearchParams();
  params.set('perPage', '1');
  params.set('fields', 'id');
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records?${params.toString()}`, {
    headers: authHeaders(pbToken),
  });
  if (!res.ok) {
    return { ok: false, error: { kind: 'backend', status: res.status, body: await res.text() } };
  }
  const body = (await res.json()) as { totalItems: number };
  return { ok: true, value: body.totalItems };
}
