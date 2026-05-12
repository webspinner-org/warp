/**
 * `wp_operations` — the meta-runtime operation log.
 *
 * Every multi-step task the Loom performs on the Wizard's (or
 * eventually the patron's) behalf writes one row here at the end of
 * execution. The row captures the envelope of the operation:
 *   - what kind of operation it was
 *   - who triggered it
 *   - structured input
 *   - structured output (or error)
 *   - timing
 *
 * Individual sub-events (each file write, each Spinner invocation, each
 * SI call) live in `wp_audit` and reference the operation via
 * `correlation_id == wp_operations.op_id`. The two collections together
 * tell the full story.
 *
 * This is the substrate the SI log-interpreter Spinner will read when
 * the patron asks "what went wrong?" — it scans recent operations for
 * `status: failed`, walks the linked audit events, and translates.
 *
 * The collection is created idempotently on first write so the Loom
 * boots clean on a fresh Cell.
 */

import { randomUUID } from 'node:crypto';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_operations';

export type OperationKind =
  | 'spinner.sign'
  | 'spinner.verify'
  | 'spinner.author'
  | 'spinner.publish'
  | 'spinner.install'
  | 'spinner.update'
  | 'spinner.uninstall'
  | 'runner.dispatch';

export type OperationStatus = 'ok' | 'failed' | 'partial';

export interface OperationActor {
  /** wizard | patron | meta-runtime | system */
  readonly kind: 'wizard' | 'patron' | 'meta-runtime' | 'system';
  readonly id: string;
  readonly email?: string;
}

export interface OperationWriteRequest {
  readonly kind: OperationKind;
  readonly status: OperationStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly actor: OperationActor;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output?: Readonly<Record<string, unknown>>;
  readonly error?: { readonly kind: string; readonly message: string };
  /** Optional correlation to a parent operation (e.g. a publish op contains a sign op). */
  readonly parentOpId?: string;
}

export interface OperationRow {
  readonly id: string;
  readonly opId: string;
  readonly kind: OperationKind;
  readonly status: OperationStatus;
  readonly startedAt: string;
  readonly endedAt: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

export async function ensureOperationsCollection(
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
        { name: 'op_id', type: 'text', required: true, unique: true, max: 64 },
        { name: 'kind', type: 'text', required: true, max: 64 },
        { name: 'status', type: 'text', required: true, max: 16 },
        { name: 'started_at', type: 'text', required: true, max: 32 },
        { name: 'ended_at', type: 'text', required: true, max: 32 },
        { name: 'actor_kind', type: 'text', required: true, max: 16 },
        { name: 'actor_id', type: 'text', required: true, max: 128 },
        { name: 'actor_email', type: 'text', required: false, max: 256 },
        { name: 'input', type: 'json', required: false, maxSize: 65536 },
        { name: 'output', type: 'json', required: false, maxSize: 65536 },
        { name: 'error_kind', type: 'text', required: false, max: 64 },
        { name: 'error_message', type: 'text', required: false, max: 1024 },
        { name: 'parent_op_id', type: 'text', required: false, max: 64 },
        { name: 'embedding', type: 'json', required: false, maxSize: 16384 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${COLLECTION}_op_id ON ${COLLECTION} (op_id)`,
        `CREATE INDEX idx_${COLLECTION}_kind_started ON ${COLLECTION} (kind, started_at DESC)`,
        `CREATE INDEX idx_${COLLECTION}_status_started ON ${COLLECTION} (status, started_at DESC)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

/**
 * Write one operation row. Returns the assigned `op_id` (a UUID, suitable
 * for `correlation_id` on linked audit events). Idempotently ensures the
 * collection exists before the write.
 */
export async function writeOperation(
  fetchFn: typeof fetch,
  token: string,
  req: OperationWriteRequest,
): Promise<{ ok: true; row: OperationRow } | { ok: false; status: number; body: string }> {
  const ensure = await ensureOperationsCollection(fetchFn, token);
  if (!ensure.ok) return ensure;

  const opId = randomUUID();
  const body: Record<string, unknown> = {
    op_id: opId,
    kind: req.kind,
    status: req.status,
    started_at: req.startedAt,
    ended_at: req.endedAt,
    actor_kind: req.actor.kind,
    actor_id: req.actor.id,
    actor_email: req.actor.email ?? '',
    input: req.input,
  };
  if (req.output !== undefined) body['output'] = req.output;
  if (req.error !== undefined) {
    body['error_kind'] = req.error.kind;
    body['error_message'] = req.error.message;
  }
  if (req.parentOpId !== undefined) body['parent_op_id'] = req.parentOpId;

  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, body: await res.text() };
  }
  const row = (await res.json()) as { id: string };
  return {
    ok: true,
    row: {
      id: row.id,
      opId,
      kind: req.kind,
      status: req.status,
      startedAt: req.startedAt,
      endedAt: req.endedAt,
    },
  };
}
