/**
 * Verifier dispatchers — each step can declare one of four verifier
 * kinds. The dispatcher runs the declared check against PocketBase or
 * the Loom's own routes and returns `{ ok, observation, evidence }`.
 *
 * Verifiers are advisory — a failed verifier doesn't block the patron
 * from approving the step. The right-column UI surfaces the
 * verifier's verdict so the patron sees what the server thinks,
 * but their judgement is what writes the audit event.
 *
 * Why advisory: a verifier might be wrong (the test environment
 * differs from real, the timing window is too tight). The patron's
 * eyes are still the source of truth — verifiers add evidence, they
 * don't gate.
 */

import { substitutePlaceholders } from './loader.js';
import type {
  AuditEventVerifier,
  OpEnvelopeVerifier,
  PbRowExistsVerifier,
  RouteStatusVerifier,
  StepVerifier,
  VerifierResult,
} from './types.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const LOOM_BASE = process.env['WARP_LOOM_BASE'] ?? 'http://localhost:3000';

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

export interface RunVerifierInput {
  readonly fetch: typeof fetch;
  readonly pbToken: string;
  readonly verifier: StepVerifier;
  readonly answers: Record<string, Record<string, unknown>>;
  /**
   * Cookie header to forward with route-status checks so the verifier
   * authenticates as the same session that started the run. Without
   * it the verifier sees 303-to-/login for admin routes.
   */
  readonly cookieHeader?: string;
  /**
   * Override the Loom origin for route-status checks (e.g. tests).
   */
  readonly loomBaseOverride?: string;
}

export async function runVerifier(input: RunVerifierInput): Promise<VerifierResult> {
  try {
    switch (input.verifier.kind) {
      case 'route-status':
        return await verifyRouteStatus(input, input.verifier);
      case 'pb-row-exists':
        return await verifyPbRowExists(input, input.verifier);
      case 'audit-event':
        return await verifyAuditEvent(input, input.verifier);
      case 'op-envelope':
        return await verifyOpEnvelope(input, input.verifier);
    }
  } catch (err) {
    return {
      ok: false,
      observation: `Verifier threw: ${(err as Error).message}`,
      evidence: { error: String(err) },
    };
  }
}

async function verifyRouteStatus(
  input: RunVerifierInput,
  v: RouteStatusVerifier,
): Promise<VerifierResult> {
  const path = substitutePlaceholders(v.path, input.answers);
  const base = input.loomBaseOverride ?? LOOM_BASE;
  const url = `${base}${path}`;
  const expectStatus = v.expectStatus ?? 200;
  const headers: Record<string, string> = {};
  if (input.cookieHeader) headers['Cookie'] = input.cookieHeader;
  const res = await input.fetch(url, { headers, redirect: 'manual' });
  const body = await res.text();
  const statusOk = res.status === expectStatus;
  const contains = v.bodyContains ?? [];
  const missing = contains.filter((needle) => !body.includes(needle));
  const ok = statusOk && missing.length === 0;
  const observation = ok
    ? `GET ${path} → ${res.status}${contains.length > 0 ? `; all ${contains.length} body asserts matched` : ''}`
    : !statusOk
      ? `GET ${path} → ${res.status} (expected ${expectStatus})`
      : `GET ${path} → ${res.status} but body missing: ${missing.join(', ')}`;
  return {
    ok,
    observation,
    evidence: {
      url,
      status: res.status,
      expectStatus,
      bodyContainsAsserted: contains,
      bodyContainsMissing: missing,
    },
  };
}

async function verifyPbRowExists(
  input: RunVerifierInput,
  v: PbRowExistsVerifier,
): Promise<VerifierResult> {
  const filter = substitutePlaceholders(v.filter, input.answers);
  if (filter.includes('{{answer.')) {
    return {
      ok: false,
      observation: `Verifier deferred: unresolved placeholder in filter "${filter}"`,
      evidence: { collection: v.collection, filter },
    };
  }
  const params = new URLSearchParams();
  params.set('perPage', '1');
  params.set('filter', filter);
  const url = `${PB_URL}/api/collections/${v.collection}/records?${params.toString()}`;
  const res = await input.fetch(url, { headers: authHeaders(input.pbToken) });
  if (!res.ok) {
    return {
      ok: false,
      observation: `PB query failed: ${res.status}`,
      evidence: { collection: v.collection, filter, status: res.status, body: await res.text() },
    };
  }
  const body = (await res.json()) as { items: readonly Record<string, unknown>[] };
  const row = body.items[0];
  if (!row) {
    return {
      ok: false,
      observation: `No row in ${v.collection} matching ${filter}`,
      evidence: { collection: v.collection, filter, rowCount: 0 },
    };
  }
  const asserts = v.assertFields ?? {};
  const mismatches: { field: string; expected: string; actual: unknown }[] = [];
  for (const [field, expectedRaw] of Object.entries(asserts)) {
    const expected = substitutePlaceholders(expectedRaw, input.answers);
    if (String(row[field]) !== expected) {
      mismatches.push({ field, expected, actual: row[field] });
    }
  }
  const ok = mismatches.length === 0;
  return {
    ok,
    observation: ok
      ? `Row found in ${v.collection}${Object.keys(asserts).length > 0 ? `; ${Object.keys(asserts).length} field asserts matched` : ''}`
      : `Row found but ${mismatches.length} field assert(s) failed`,
    evidence: { collection: v.collection, filter, row, mismatches },
  };
}

async function verifyAuditEvent(
  input: RunVerifierInput,
  v: AuditEventVerifier,
): Promise<VerifierResult> {
  const windowSec = v.windowSec ?? 600;
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const filters = [
    `event_type = ${JSON.stringify(v.eventType)}`,
    `event_time >= ${JSON.stringify(since)}`,
  ];
  if (v.subjectContains) {
    filters.push(`event_subject ~ ${JSON.stringify(v.subjectContains)}`);
  }
  const params = new URLSearchParams();
  params.set('perPage', '5');
  params.set('sort', '-event_time');
  params.set('filter', filters.join(' && '));
  const url = `${PB_URL}/api/collections/wp_audit/records?${params.toString()}`;
  const res = await input.fetch(url, { headers: authHeaders(input.pbToken) });
  if (!res.ok) {
    return {
      ok: false,
      observation: `Audit query failed: ${res.status}`,
      evidence: { eventType: v.eventType, status: res.status, body: await res.text() },
    };
  }
  const body = (await res.json()) as {
    items: readonly Record<string, unknown>[];
    totalItems: number;
  };
  const found = body.items[0];
  if (!found) {
    return {
      ok: false,
      observation: `No ${v.eventType} event in the last ${windowSec}s`,
      evidence: { eventType: v.eventType, windowSec, since, totalFound: 0 },
    };
  }
  return {
    ok: true,
    observation: `Found ${body.totalItems} ${v.eventType} event(s) in the last ${windowSec}s (latest at ${String(found['event_time'])})`,
    evidence: {
      eventType: v.eventType,
      latest: found,
      totalFound: body.totalItems,
    },
  };
}

async function verifyOpEnvelope(
  input: RunVerifierInput,
  v: OpEnvelopeVerifier,
): Promise<VerifierResult> {
  const windowSec = v.windowSec ?? 600;
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const status = v.status ?? 'ok';
  const filter = [
    `kind = ${JSON.stringify(v.opKind)}`,
    `status = ${JSON.stringify(status)}`,
    `started_at >= ${JSON.stringify(since)}`,
  ].join(' && ');
  const params = new URLSearchParams();
  params.set('perPage', '5');
  params.set('sort', '-started_at');
  params.set('filter', filter);
  const url = `${PB_URL}/api/collections/wp_operations/records?${params.toString()}`;
  const res = await input.fetch(url, { headers: authHeaders(input.pbToken) });
  if (!res.ok) {
    return {
      ok: false,
      observation: `Operations query failed: ${res.status}`,
      evidence: { opKind: v.opKind, status: res.status, body: await res.text() },
    };
  }
  const body = (await res.json()) as {
    items: readonly Record<string, unknown>[];
    totalItems: number;
  };
  const found = body.items[0];
  if (!found) {
    return {
      ok: false,
      observation: `No ${v.opKind} op (status=${status}) in the last ${windowSec}s`,
      evidence: { opKind: v.opKind, expectedStatus: status, windowSec, since, totalFound: 0 },
    };
  }
  return {
    ok: true,
    observation: `Found ${body.totalItems} ${v.opKind} envelope(s); latest started at ${String(found['started_at'])}`,
    evidence: {
      opKind: v.opKind,
      latest: found,
      totalFound: body.totalItems,
    },
  };
}
