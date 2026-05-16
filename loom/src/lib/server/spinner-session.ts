// `wp_spinner_sessions` — re-entrant per-Spinner working state.
//
// One row per (spinner_id, session_id) pair. The Loom (today) and the
// canonical Weaver (later) load the row before dispatching a capability,
// hand its `state` + `phase` into the `SpinnerContext.session` primitive,
// and let the Spinner mutate-and-save without ever touching PocketBase
// directly. The shape mirrors `wp_weavers_tension_runs` (which is the
// feature-scoped re-entrancy precedent) but generalised to any Spinner:
// the row IS the resume point.
//
// What this layer does:
//
//   - Idempotently ensures the collection exists (matches the
//     `wp_operations` / `wp_weavers_tension_runs` pattern: HEAD,
//     create-if-404, return ok).
//   - Loads a session row by (spinnerId, sessionId); reports
//     `isFirstTurn: true` when none exists.
//   - Upserts on `save()` — last-writer-wins, atomic at the PB record
//     level. v0 has no optimistic-concurrency check; the Loom
//     serialises patron turns above this layer.
//   - Emits `wp.spinner.session.save` per write — payload is metadata
//     only (spinnerId, sessionId, phase, status, byte count, first-turn
//     flag). The state's value is not in the audit chain.
//
// What this layer does NOT do (yet):
//
//   - Sweep / cleanup. Sessions accumulate; an `updated < 30d` reaper
//     job is on the runway, not in this file.
//   - Concurrent-write detection. Future revision adds a `version`
//     field + optimistic check when a Spinner has overlapping
//     invocations on the same session.
//   - Session-level audit history (every state mutation as a separate
//     audit row). Today the row carries the *latest* state; the audit
//     chain carries the metadata trail of how it got there.

import type {
  AuditEvent,
  SpinnerAuditDraft,
  SpinnerName,
  SpinnerSession,
} from '@webspinner-foundation/sdk';

const PB_URL_DEFAULT = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_spinner_sessions';
const MAX_STATE_BYTES = 256 * 1024; // 256 KB hard cap on serialised state JSON

export type SessionStatus = 'active' | 'completed' | 'aborted';

export interface SpinnerSessionActor {
  /** Mirrors OperationActor.kind from operations.ts. */
  readonly kind: 'wizard' | 'webspinner' | 'meta-runtime' | 'system';
  readonly id: string;
  readonly email?: string;
}

export interface SpinnerSessionRow {
  readonly id: string;
  readonly spinnerId: SpinnerName;
  readonly sessionId: string;
  readonly actor: SpinnerSessionActor;
  readonly phase: string;
  readonly lastCapability: string;
  readonly state: Record<string, unknown>;
  readonly status: SessionStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
}

interface PBSessionRow {
  readonly id: string;
  readonly spinner_id: string;
  readonly session_id: string;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly actor_email?: string;
  readonly phase: string;
  readonly last_capability: string;
  readonly state: Record<string, unknown> | null;
  readonly status: string;
  readonly started_at: string;
  readonly updated_at: string;
  readonly ended_at?: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

function parseRow(row: PBSessionRow): SpinnerSessionRow {
  const actor: SpinnerSessionActor = {
    kind: row.actor_kind as SpinnerSessionActor['kind'],
    id: row.actor_id,
    ...(row.actor_email && row.actor_email.length > 0 ? { email: row.actor_email } : {}),
  };
  return {
    id: row.id,
    spinnerId: row.spinner_id as SpinnerName,
    sessionId: row.session_id,
    actor,
    phase: row.phase,
    lastCapability: row.last_capability,
    state: row.state ?? {},
    status: row.status as SessionStatus,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at && row.ended_at.length > 0 ? row.ended_at : null,
  };
}

/**
 * Idempotently ensure the `wp_spinner_sessions` collection exists.
 * HEAD; on 404 create with the canonical schema; return `{ ok: true }`
 * either way. Matches the pattern in `operations.ts` and
 * `weavers-tension/runs.ts`.
 */
export async function ensureSpinnerSessionsCollection(
  fetchFn: typeof fetch,
  token: string,
  pbUrl: string = PB_URL_DEFAULT,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const head = await fetchFn(`${pbUrl}/api/collections/${COLLECTION}`, {
    headers: authHeaders(token),
  });
  if (head.ok) return { ok: true };
  if (head.status !== 404) return { ok: false, status: head.status, body: await head.text() };

  const create = await fetchFn(`${pbUrl}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'spinner_id', type: 'text', required: true, max: 128 },
        { name: 'session_id', type: 'text', required: true, max: 64 },
        { name: 'actor_kind', type: 'text', required: true, max: 16 },
        { name: 'actor_id', type: 'text', required: true, max: 128 },
        { name: 'actor_email', type: 'text', required: false, max: 256 },
        { name: 'phase', type: 'text', required: true, max: 64 },
        { name: 'last_capability', type: 'text', required: true, max: 64 },
        { name: 'state', type: 'json', required: false, maxSize: MAX_STATE_BYTES },
        { name: 'status', type: 'text', required: true, max: 16 },
        { name: 'started_at', type: 'text', required: true, max: 32 },
        { name: 'updated_at', type: 'text', required: true, max: 32 },
        { name: 'ended_at', type: 'text', required: false, max: 32 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${COLLECTION}_spinner_session ON ${COLLECTION} (spinner_id, session_id)`,
        `CREATE INDEX idx_${COLLECTION}_status_updated ON ${COLLECTION} (status, updated_at DESC)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

/**
 * Load the session row for (spinnerId, sessionId). Returns the parsed
 * row or `null` when none exists (i.e. this is the first turn in the
 * session).
 */
export async function loadSpinnerSession(
  fetchFn: typeof fetch,
  token: string,
  spinnerId: SpinnerName,
  sessionId: string,
  pbUrl: string = PB_URL_DEFAULT,
): Promise<
  { ok: true; row: SpinnerSessionRow | null } | { ok: false; status: number; body: string }
> {
  const params = new URLSearchParams();
  params.set('perPage', '1');
  params.set(
    'filter',
    `spinner_id = ${JSON.stringify(spinnerId)} && session_id = ${JSON.stringify(sessionId)}`,
  );
  const res = await fetchFn(`${pbUrl}/api/collections/${COLLECTION}/records?${params.toString()}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as { items?: readonly PBSessionRow[] };
  const row = body.items && body.items.length > 0 ? parseRow(body.items[0]!) : null;
  return { ok: true, row };
}

export interface CreateSpinnerSessionInput {
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly spinnerId: SpinnerName;
  readonly sessionId: string;
  readonly actor: SpinnerSessionActor;
  readonly capability: string;
  /** Emits the canonical `wp.spinner.session.save` event per save. */
  readonly emitAudit: (event: SpinnerAuditDraft) => Promise<AuditEvent>;
  readonly pbUrl?: string;
}

/**
 * Build a `SpinnerSession` for a Spinner capability invocation. Loads
 * the prior row (or marks `isFirstTurn: true` if absent) and returns an
 * object with a `save()` method that upserts the row and emits the
 * canonical audit event.
 *
 * The dispatcher constructs this once per invocation and hands it to
 * the capability handler as `context.session`. The Spinner author
 * mutates and saves as the work progresses.
 */
export async function createSpinnerSession(
  input: CreateSpinnerSessionInput,
): Promise<SpinnerSession> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const loaded = await loadSpinnerSession(
    input.fetchFn,
    input.token,
    input.spinnerId,
    input.sessionId,
    pbUrl,
  );
  if (!loaded.ok) {
    throw new Error(
      `Failed to load session "${input.sessionId}" for ${input.spinnerId}: PB ${loaded.status} ${loaded.body}`,
    );
  }

  const initialRow = loaded.row;
  // Snapshot at construction; the Spinner mutates via save(), which
  // round-trips through PB and refreshes the snapshot.
  let recordId: string | null = initialRow?.id ?? null;
  let phase: string = initialRow?.phase ?? '';
  let state: Record<string, unknown> = initialRow?.state ?? {};
  const startedAt = initialRow?.startedAt ?? new Date().toISOString();

  async function save(next: {
    readonly state: Record<string, unknown>;
    readonly phase: string;
    readonly status?: SessionStatus;
  }): Promise<void> {
    const serialised = JSON.stringify(next.state);
    if (serialised.length > MAX_STATE_BYTES) {
      throw new Error(
        `Spinner session state for ${input.spinnerId} / ${input.sessionId} is ${serialised.length} bytes; max is ${MAX_STATE_BYTES}.`,
      );
    }
    const status: SessionStatus = next.status ?? 'active';
    const nowIso = new Date().toISOString();
    const isFirstSave = recordId === null;

    const payload: Record<string, unknown> = {
      spinner_id: input.spinnerId,
      session_id: input.sessionId,
      actor_kind: input.actor.kind,
      actor_id: input.actor.id,
      ...(input.actor.email ? { actor_email: input.actor.email } : {}),
      phase: next.phase,
      last_capability: input.capability,
      state: next.state,
      status,
      started_at: startedAt,
      updated_at: nowIso,
      ...(status !== 'active' ? { ended_at: nowIso } : {}),
    };

    const url = isFirstSave
      ? `${pbUrl}/api/collections/${COLLECTION}/records`
      : `${pbUrl}/api/collections/${COLLECTION}/records/${recordId}`;
    const res = await input.fetchFn(url, {
      method: isFirstSave ? 'POST' : 'PATCH',
      headers: authHeaders(input.token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to save session "${input.sessionId}" for ${input.spinnerId}: PB ${res.status} ${await res.text()}`,
      );
    }
    const saved = (await res.json()) as PBSessionRow;
    recordId = saved.id;
    phase = next.phase;
    state = next.state;

    await input.emitAudit({
      type: 'wp.spinner.session.save',
      subject: `wp://spinner-session/${input.spinnerId}/${input.sessionId}`,
      reason: 'spinner-session-state-saved',
      data: {
        spinnerId: input.spinnerId,
        sessionId: input.sessionId,
        phase: next.phase,
        status,
        stateBytes: serialised.length,
        firstTurn: isFirstSave,
      },
    });
  }

  return {
    id: input.sessionId,
    isFirstTurn: initialRow === null,
    get state() {
      return state;
    },
    get phase() {
      return phase;
    },
    save,
  };
}
