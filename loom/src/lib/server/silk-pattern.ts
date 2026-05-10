// Silk Pattern reader/writer.
//
// The Silk Pattern is the per-Spinner memory: history of invocations
// plus aggregate metrics, surfaced as a placard on the Spinner detail
// page. Bootstrap implementation: PocketBase collection `wp_silk_pattern`.

import { randomUUID } from 'node:crypto';
import type {
  AuditResult,
  SilkPattern,
  SilkPatternEntry,
  SilkPatternMetrics,
  SpinnerName,
} from '@webspinner-foundation/sdk';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_silk_pattern';
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_RECENT_LIMIT = 10;

export interface SilkAppendRequest {
  readonly spinner: SpinnerName;
  readonly capability: string;
  readonly invokedAt: string;
  readonly durationMs: number;
  readonly result: AuditResult;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly auditEventId?: string;
  readonly errorMessage?: string;
}

interface PBRow {
  readonly id: string;
  readonly entry_id: string;
  readonly spinner: string;
  readonly capability: string;
  readonly invoked_at: string;
  readonly duration_ms: number;
  readonly silk_result: string;
  readonly input_summary: string;
  readonly output_summary: string;
  readonly audit_event_id?: string;
  readonly error_message?: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

export async function ensureSilkPatternCollection(
  fetchFn: typeof fetch,
  token: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const head = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}`, {
    headers: authHeaders(token),
  });
  if (head.ok) return { ok: true };
  if (head.status !== 404) return { ok: false, status: head.status, body: await head.text() };

  const create = await fetchFn(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'entry_id', type: 'text', required: true, unique: true, max: 64 },
        { name: 'spinner', type: 'text', required: true, max: 128 },
        { name: 'capability', type: 'text', required: true, max: 64 },
        { name: 'invoked_at', type: 'text', required: true, max: 32 },
        { name: 'duration_ms', type: 'number', required: true },
        { name: 'silk_result', type: 'text', required: true, max: 16 },
        { name: 'input_summary', type: 'text', required: true, max: 512 },
        { name: 'output_summary', type: 'text', required: true, max: 512 },
        { name: 'audit_event_id', type: 'text', required: false, max: 64 },
        { name: 'error_message', type: 'text', required: false, max: 512 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE INDEX idx_${COLLECTION}_spinner_time ON ${COLLECTION} (spinner, invoked_at DESC)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

export async function appendSilkPattern(
  fetchFn: typeof fetch,
  token: string,
  req: SilkAppendRequest,
): Promise<string> {
  const entryId = randomUUID();
  const body = {
    entry_id: entryId,
    spinner: req.spinner,
    capability: req.capability,
    invoked_at: req.invokedAt,
    duration_ms: req.durationMs,
    silk_result: req.result,
    input_summary: req.inputSummary,
    output_summary: req.outputSummary,
    audit_event_id: req.auditEventId ?? '',
    error_message: req.errorMessage ?? '',
  };
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`silk pattern write failed: ${res.status} ${await res.text()}`);
  }
  return entryId;
}

export async function readSilkPattern(
  fetchFn: typeof fetch,
  token: string,
  spinner: SpinnerName,
  options: { recentLimit?: number; windowDays?: number } = {},
): Promise<SilkPattern> {
  const recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const filter = encodeURIComponent(`spinner = "${spinner}" && invoked_at >= "${windowStart.toISOString()}"`);
  const url = `${PB_URL}/api/collections/${COLLECTION}/records?filter=${filter}&perPage=500&sort=-invoked_at`;
  const res = await fetchFn(url, { headers: authHeaders(token) });

  if (!res.ok) {
    return {
      spinner,
      metrics: emptyMetrics(windowStart, windowEnd),
      recent: [],
    };
  }

  const body = (await res.json()) as { items: readonly PBRow[] };
  const items = body.items ?? [];

  const metrics = computeMetrics(items, windowStart, windowEnd);
  const recent = items.slice(0, recentLimit).map<SilkPatternEntry>((row) => ({
    id: row.entry_id,
    spinner: row.spinner as SpinnerName,
    capability: row.capability,
    invokedAt: row.invoked_at,
    durationMs: row.duration_ms,
    result: row.silk_result as AuditResult,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    ...(row.audit_event_id ? { auditEventId: row.audit_event_id } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
  }));

  return { spinner, metrics, recent };
}

function emptyMetrics(start: Date, end: Date): SilkPatternMetrics {
  return {
    invocations: 0,
    successes: 0,
    errors: 0,
    denials: 0,
    avgDurationMs: 0,
    lastInvokedAt: null,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

function computeMetrics(
  rows: readonly PBRow[],
  start: Date,
  end: Date,
): SilkPatternMetrics {
  if (rows.length === 0) return emptyMetrics(start, end);
  let successes = 0;
  let errors = 0;
  let denials = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const row of rows) {
    switch (row.silk_result) {
      case 'success':
        successes++;
        durationSum += row.duration_ms;
        durationCount++;
        break;
      case 'error':
        errors++;
        break;
      case 'denied':
        denials++;
        break;
    }
  }
  return {
    invocations: rows.length,
    successes,
    errors,
    denials,
    avgDurationMs: durationCount === 0 ? 0 : Math.round(durationSum / durationCount),
    lastInvokedAt: rows[0]?.invoked_at ?? null,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

export function summariseInput(capability: string, input: unknown): string {
  if (input === null || input === undefined) return `${capability}()`;
  if (typeof input === 'string') return clip(`${capability}: ${input}`, 200);
  try {
    const json = JSON.stringify(input);
    return clip(`${capability}: ${json}`, 200);
  } catch {
    return capability;
  }
}

export function summariseOutput(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return clip(output, 200);
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;
    const answer = obj['answer'] ?? obj['entry'] ?? obj['summary'] ?? obj['verdict_text'];
    if (typeof answer === 'string') return clip(answer, 200);
  }
  try {
    return clip(JSON.stringify(output), 200);
  } catch {
    return '';
  }
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
