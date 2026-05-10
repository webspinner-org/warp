// Audit-event writer. Bootstrap implementation: PocketBase collection
// `wp_audit`, schema below. The canonical scheme — append-only with
// cryptographic chaining — is open work (`OPEN_QUESTIONS.md` — *Audit
// log — cryptographic chaining scheme*). Today the events land
// faithfully but the chain integrity primitives are not yet wired.

import { randomUUID } from 'node:crypto';
import type {
  AuditActor,
  AuditEventType,
  AuditOcsfClass,
  AuditResult,
} from '@webspinner-foundation/sdk';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_audit';

export interface AuditWriteRequest {
  readonly type: AuditEventType;
  readonly source: string;
  readonly actor: AuditActor;
  readonly result: AuditResult;
  readonly reason: string;
  readonly subject?: string;
  readonly correlationId?: string;
  readonly ocsfClass: AuditOcsfClass;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AuditWriteResult {
  readonly id: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

export async function ensureAuditCollection(
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
        { name: 'event_id', type: 'text', required: true, unique: true, max: 64 },
        { name: 'event_type', type: 'text', required: true, max: 64 },
        { name: 'event_source', type: 'text', required: true, max: 256 },
        { name: 'event_subject', type: 'text', required: false, max: 512 },
        { name: 'event_time', type: 'text', required: true, max: 32 },
        { name: 'actor_kind', type: 'text', required: true, max: 16 },
        { name: 'actor_id', type: 'text', required: true, max: 128 },
        { name: 'actor_display_name', type: 'text', required: false, max: 128 },
        { name: 'audit_result', type: 'text', required: true, max: 16 },
        { name: 'audit_reason', type: 'text', required: true, max: 512 },
        { name: 'correlation_id', type: 'text', required: false, max: 64 },
        { name: 'ocsf_class', type: 'number', required: true },
        { name: 'data', type: 'json', required: false, maxSize: 65536 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${COLLECTION}_event_id ON ${COLLECTION} (event_id)`,
        `CREATE INDEX idx_${COLLECTION}_type_time ON ${COLLECTION} (event_type, event_time DESC)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

export async function writeAuditEvent(
  fetchFn: typeof fetch,
  token: string,
  req: AuditWriteRequest,
): Promise<AuditWriteResult> {
  const eventId = randomUUID();
  const body = {
    event_id: eventId,
    event_type: req.type,
    event_source: req.source,
    event_subject: req.subject ?? '',
    event_time: new Date().toISOString(),
    actor_kind: req.actor.kind,
    actor_id: req.actor.id,
    actor_display_name: req.actor.displayName ?? '',
    audit_result: req.result,
    audit_reason: req.reason,
    correlation_id: req.correlationId ?? '',
    ocsf_class: req.ocsfClass,
    data: req.data,
  };
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`audit write failed: ${res.status} ${await res.text()}`);
  }
  return { id: eventId };
}
