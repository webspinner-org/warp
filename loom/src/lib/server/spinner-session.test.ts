import { describe, it, expect, vi } from 'vitest';
import type { AuditEvent, SpinnerAuditDraft, SpinnerName } from '@webspinner-foundation/sdk';
import {
  ensureSpinnerSessionsCollection,
  loadSpinnerSession,
  createSpinnerSession,
  type SpinnerSessionActor,
} from './spinner-session.js';

const SPINNER = '@webspinner-foundation/database-application' as SpinnerName;
const PB_URL = 'http://pb.local';

function pbMock(): {
  fetch: typeof fetch;
  state: {
    collection: boolean;
    rows: Record<string, unknown>[];
  };
} {
  const state = {
    collection: false,
    rows: [] as Record<string, unknown>[],
  };
  let nextId = 1;
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const notFound = () => new Response('{"code":404}', { status: 404 });

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;

    if (path === '/api/collections/wp_spinner_sessions' && method === 'GET') {
      return state.collection ? ok({ name: 'wp_spinner_sessions' }) : notFound();
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_spinner_sessions') state.collection = true;
      return ok({ name: body.name });
    }
    if (path === '/api/collections/wp_spinner_sessions/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.rows.push(row);
      return ok(row);
    }
    if (path.startsWith('/api/collections/wp_spinner_sessions/records/') && method === 'PATCH') {
      const id = path.split('/').pop();
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const idx = state.rows.findIndex((r) => r['id'] === id);
      if (idx < 0) return new Response('not found', { status: 404 });
      state.rows[idx] = { ...state.rows[idx], ...body };
      return ok(state.rows[idx]);
    }
    if (path === '/api/collections/wp_spinner_sessions/records' && method === 'GET') {
      const u = new URL(url);
      const filter = u.searchParams.get('filter') ?? '';
      let rows = [...state.rows];
      const spinnerMatch = /spinner_id = "([^"]+)"/.exec(filter);
      const sessionMatch = /session_id = "([^"]+)"/.exec(filter);
      if (spinnerMatch) rows = rows.filter((r) => r['spinner_id'] === spinnerMatch[1]);
      if (sessionMatch) rows = rows.filter((r) => r['session_id'] === sessionMatch[1]);
      const perPage = Math.min(200, Number(u.searchParams.get('perPage') ?? 50));
      return ok({ items: rows.slice(0, perPage) });
    }
    return notFound();
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

const auditNoop = vi.fn<(e: SpinnerAuditDraft) => Promise<AuditEvent>>(
  async () => ({}) as AuditEvent,
);
const wizardActor: SpinnerSessionActor = {
  kind: 'wizard',
  id: 'wizard-user-id',
  email: 'wizard@webspinner.foundation',
};

describe('wp_spinner_sessions', () => {
  it('ensureSpinnerSessionsCollection is idempotent', async () => {
    const pb = pbMock();
    const a = await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    expect(a.ok).toBe(true);
    expect(pb.state.collection).toBe(true);
    const b = await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    expect(b.ok).toBe(true);
  });

  it('returns null when no session row exists', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    const r = await loadSpinnerSession(pb.fetch, 'tok', SPINNER, 'session-001', PB_URL);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.row).toBeNull();
  });

  it('first-turn session reports isFirstTurn=true and empty state', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    const audit = vi.fn(async (_e: SpinnerAuditDraft) => ({}) as AuditEvent);
    const session = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-001',
      actor: wizardActor,
      capability: 'propose',
      emitAudit: audit,
      pbUrl: PB_URL,
    });
    expect(session.isFirstTurn).toBe(true);
    expect(session.state).toEqual({});
    expect(session.phase).toBe('');
    expect(audit).not.toHaveBeenCalled();
  });

  it('first save() creates a row and emits the audit event with firstTurn=true', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    const audit = vi.fn(async (_e: SpinnerAuditDraft) => ({}) as AuditEvent);
    const session = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-001',
      actor: wizardActor,
      capability: 'propose',
      emitAudit: audit,
      pbUrl: PB_URL,
    });
    await session.save({
      state: { intent: 'bookkeeping system', research: { sources: ['en.wikipedia.org'] } },
      phase: 'proposed',
    });
    expect(pb.state.rows).toHaveLength(1);
    expect(pb.state.rows[0]?.['phase']).toBe('proposed');
    expect(pb.state.rows[0]?.['status']).toBe('active');
    expect(audit).toHaveBeenCalledOnce();
    const evt = audit.mock.calls[0]![0]!;
    expect(evt.type).toBe('wp.spinner.session.save');
    expect((evt.data as Record<string, unknown>)['firstTurn']).toBe(true);
    expect((evt.data as Record<string, unknown>)['phase']).toBe('proposed');
    // State value must NOT be in the audit payload.
    expect(JSON.stringify(evt.data)).not.toContain('bookkeeping system');
  });

  it('subsequent save() updates the same row and reports firstTurn=false', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    const audit = vi.fn(async (_e: SpinnerAuditDraft) => ({}) as AuditEvent);
    const session = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-001',
      actor: wizardActor,
      capability: 'propose',
      emitAudit: audit,
      pbUrl: PB_URL,
    });
    await session.save({ state: { phase: 1 }, phase: 'proposed' });
    await session.save({ state: { phase: 2 }, phase: 'refining' });
    expect(pb.state.rows).toHaveLength(1);
    expect(pb.state.rows[0]?.['phase']).toBe('refining');
    expect(audit).toHaveBeenCalledTimes(2);
    expect((audit.mock.calls[1]![0]!.data as Record<string, unknown>)['firstTurn']).toBe(false);
  });

  it('returning patron sees prior state with isFirstTurn=false', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    // First invocation persists state.
    const s1 = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-001',
      actor: wizardActor,
      capability: 'propose',
      emitAudit: auditNoop,
      pbUrl: PB_URL,
    });
    await s1.save({
      state: { entities: ['transaction', 'account', 'category'] },
      phase: 'proposed',
    });
    // Second invocation re-loads the row.
    const s2 = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-001',
      actor: wizardActor,
      capability: 'refine',
      emitAudit: auditNoop,
      pbUrl: PB_URL,
    });
    expect(s2.isFirstTurn).toBe(false);
    expect(s2.phase).toBe('proposed');
    expect((s2.state as Record<string, unknown>)['entities']).toEqual([
      'transaction',
      'account',
      'category',
    ]);
  });

  it('records ended_at when status leaves active', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    const session = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-002',
      actor: wizardActor,
      capability: 'build',
      emitAudit: auditNoop,
      pbUrl: PB_URL,
    });
    await session.save({ state: { built: true }, phase: 'built', status: 'completed' });
    expect(pb.state.rows[0]?.['status']).toBe('completed');
    expect(pb.state.rows[0]?.['ended_at']).toBeTruthy();
  });

  it('refuses state past the byte cap', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    const session = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-003',
      actor: wizardActor,
      capability: 'propose',
      emitAudit: auditNoop,
      pbUrl: PB_URL,
    });
    const huge: Record<string, unknown> = { blob: 'x'.repeat(300 * 1024) };
    await expect(session.save({ state: huge, phase: 'oversized' })).rejects.toThrow(/max is/);
  });

  it('different sessions for the same Spinner do not collide', async () => {
    const pb = pbMock();
    await ensureSpinnerSessionsCollection(pb.fetch, 'tok', PB_URL);
    const sA = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-A',
      actor: wizardActor,
      capability: 'propose',
      emitAudit: auditNoop,
      pbUrl: PB_URL,
    });
    await sA.save({ state: { who: 'A' }, phase: 'a-phase' });
    const sB = await createSpinnerSession({
      fetchFn: pb.fetch,
      token: 'tok',
      spinnerId: SPINNER,
      sessionId: 'session-B',
      actor: wizardActor,
      capability: 'propose',
      emitAudit: auditNoop,
      pbUrl: PB_URL,
    });
    expect(sB.isFirstTurn).toBe(true);
    await sB.save({ state: { who: 'B' }, phase: 'b-phase' });
    expect(pb.state.rows).toHaveLength(2);
    expect(
      (pb.state.rows.find((r) => r['session_id'] === 'session-A') as Record<string, unknown>)[
        'phase'
      ],
    ).toBe('a-phase');
    expect(
      (pb.state.rows.find((r) => r['session_id'] === 'session-B') as Record<string, unknown>)[
        'phase'
      ],
    ).toBe('b-phase');
  });
});
