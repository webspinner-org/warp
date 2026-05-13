/**
 * `wp_weavers_tension_runs` — persistence for in-flight and historical
 * Weaver's Tension runs. One row per run. The row tracks the scenario
 * slug, the actor, the current step pointer, the accumulated answers,
 * the per-step results, and the full chat transcript.
 *
 * State changes are append-only at the message and stepResult level —
 * once a step is approved/flagged/skipped its result row stays; chat
 * messages are append-only. The `currentStepIndex` and `status` fields
 * advance.
 */

import { randomUUID } from 'node:crypto';
import type { OperationActor } from '../operations.js';
import type { Run, RunMessage, RunStatus, StepResult } from './types.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_weavers_tension_runs';

interface PBRunRow {
  readonly id: string;
  readonly run_id: string;
  readonly scenario_slug: string;
  readonly status: string;
  readonly op_id: string;
  readonly current_step_index: number;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly actor_email?: string;
  readonly step_results: readonly StepResult[] | null;
  readonly messages: readonly RunMessage[] | null;
  readonly answers: Record<string, Record<string, unknown>> | null;
  readonly started_at: string;
  readonly ended_at?: string;
  readonly updated_at: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

function parseRow(row: PBRunRow): Run {
  const actor: OperationActor = {
    kind: row.actor_kind as OperationActor['kind'],
    id: row.actor_id,
    ...(row.actor_email && row.actor_email.length > 0 ? { email: row.actor_email } : {}),
  };
  return {
    id: row.id,
    runId: row.run_id,
    scenarioSlug: row.scenario_slug,
    status: row.status as RunStatus,
    opId: row.op_id,
    currentStepIndex: row.current_step_index,
    actor,
    stepResults: row.step_results ?? [],
    messages: row.messages ?? [],
    answers: row.answers ?? {},
    startedAt: row.started_at,
    ...(row.ended_at && row.ended_at.length > 0 ? { endedAt: row.ended_at } : {}),
    updatedAt: row.updated_at,
  };
}

export async function ensureRunsCollection(
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
        { name: 'run_id', type: 'text', required: true, unique: true, max: 64 },
        { name: 'scenario_slug', type: 'text', required: true, max: 128 },
        { name: 'status', type: 'text', required: true, max: 16 },
        { name: 'op_id', type: 'text', required: true, max: 64 },
        // required:false is deliberate. PocketBase 0.38's `number, required:true`
        // validator rejects zero as "blank" (Go's int zero-value collides with
        // PB's "missing" semantics) and silently drops `min:0` from the
        // persisted schema, so there's no API-level workaround. The
        // application always sets this field at write time, so PB-side
        // required-validation isn't load-bearing.
        { name: 'current_step_index', type: 'number', required: false },
        { name: 'actor_kind', type: 'text', required: true, max: 16 },
        { name: 'actor_id', type: 'text', required: true, max: 128 },
        { name: 'actor_email', type: 'text', required: false, max: 256 },
        { name: 'step_results', type: 'json', required: false, maxSize: 131072 },
        { name: 'messages', type: 'json', required: false, maxSize: 524288 },
        { name: 'answers', type: 'json', required: false, maxSize: 16384 },
        { name: 'started_at', type: 'text', required: true, max: 32 },
        { name: 'ended_at', type: 'text', required: false, max: 32 },
        { name: 'updated_at', type: 'text', required: true, max: 32 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${COLLECTION}_run_id ON ${COLLECTION} (run_id)`,
        `CREATE INDEX idx_${COLLECTION}_scenario_started ON ${COLLECTION} (scenario_slug, started_at DESC)`,
        `CREATE INDEX idx_${COLLECTION}_status_started ON ${COLLECTION} (status, started_at DESC)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

export interface CreateRunRequest {
  readonly scenarioSlug: string;
  readonly opId: string;
  readonly actor: OperationActor;
}

export async function createRun(
  fetchFn: typeof fetch,
  token: string,
  req: CreateRunRequest,
): Promise<{ ok: true; run: Run } | { ok: false; status: number; body: string }> {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const payload = {
    run_id: runId,
    scenario_slug: req.scenarioSlug,
    status: 'in-progress',
    op_id: req.opId,
    current_step_index: 0,
    actor_kind: req.actor.kind,
    actor_id: req.actor.id,
    actor_email: req.actor.email ?? '',
    step_results: [],
    messages: [],
    answers: {},
    started_at: now,
    updated_at: now,
  };
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as PBRunRow;
  return { ok: true, run: parseRow(body) };
}

export async function getRun(
  fetchFn: typeof fetch,
  token: string,
  runId: string,
): Promise<{ ok: true; run: Run | null } | { ok: false; status: number; body: string }> {
  const params = new URLSearchParams();
  params.set('perPage', '1');
  params.set('filter', `run_id = ${JSON.stringify(runId)}`);
  const res = await fetchFn(
    `${PB_URL}/api/collections/${COLLECTION}/records?${params.toString()}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as { items: readonly PBRunRow[] };
  const row = body.items[0];
  if (!row) return { ok: true, run: null };
  return { ok: true, run: parseRow(row) };
}

export interface ListRunsRequest {
  readonly scenarioSlug?: string;
  readonly statuses?: readonly RunStatus[];
  readonly limit?: number;
}

export async function listRuns(
  fetchFn: typeof fetch,
  token: string,
  req: ListRunsRequest = {},
): Promise<{ ok: true; runs: readonly Run[] } | { ok: false; status: number; body: string }> {
  const filters: string[] = [];
  if (req.scenarioSlug) filters.push(`scenario_slug = ${JSON.stringify(req.scenarioSlug)}`);
  if (req.statuses && req.statuses.length > 0) {
    filters.push(`(${req.statuses.map((s) => `status = ${JSON.stringify(s)}`).join(' || ')})`);
  }
  const params = new URLSearchParams();
  params.set('perPage', String(Math.max(1, Math.min(200, req.limit ?? 50))));
  params.set('sort', '-started_at');
  if (filters.length > 0) params.set('filter', filters.join(' && '));
  const res = await fetchFn(
    `${PB_URL}/api/collections/${COLLECTION}/records?${params.toString()}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as { items: readonly PBRunRow[] };
  return { ok: true, runs: body.items.map(parseRow) };
}

async function patchRun(
  fetchFn: typeof fetch,
  token: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; run: Run } | { ok: false; status: number; body: string }> {
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as PBRunRow;
  return { ok: true, run: parseRow(body) };
}

export async function recordStepResult(
  fetchFn: typeof fetch,
  token: string,
  run: Run,
  result: StepResult,
  newAnswers?: Record<string, Record<string, unknown>>,
  advance = true,
): Promise<{ ok: true; run: Run } | { ok: false; status: number; body: string }> {
  const stepResults = [...run.stepResults.filter((r) => r.stepKey !== result.stepKey), result];
  const answers = newAnswers ? { ...run.answers, ...newAnswers } : run.answers;
  const patch: Record<string, unknown> = {
    step_results: stepResults,
    answers,
  };
  if (advance) {
    patch['current_step_index'] = run.currentStepIndex + 1;
  }
  return patchRun(fetchFn, token, run.id, patch);
}

export async function appendMessage(
  fetchFn: typeof fetch,
  token: string,
  run: Run,
  message: RunMessage,
): Promise<{ ok: true; run: Run } | { ok: false; status: number; body: string }> {
  const messages = [...run.messages, message];
  return patchRun(fetchFn, token, run.id, { messages });
}

export async function patchRunStatus(
  fetchFn: typeof fetch,
  token: string,
  run: Run,
  status: RunStatus,
): Promise<{ ok: true; run: Run } | { ok: false; status: number; body: string }> {
  return patchRun(fetchFn, token, run.id, { status });
}

export async function completeRun(
  fetchFn: typeof fetch,
  token: string,
  run: Run,
): Promise<{ ok: true; run: Run } | { ok: false; status: number; body: string }> {
  return patchRun(fetchFn, token, run.id, {
    status: 'completed',
    ended_at: new Date().toISOString(),
  });
}

export async function abortRun(
  fetchFn: typeof fetch,
  token: string,
  run: Run,
): Promise<{ ok: true; run: Run } | { ok: false; status: number; body: string }> {
  return patchRun(fetchFn, token, run.id, {
    status: 'aborted',
    ended_at: new Date().toISOString(),
  });
}

export function makeMessageId(): string {
  return randomUUID();
}
