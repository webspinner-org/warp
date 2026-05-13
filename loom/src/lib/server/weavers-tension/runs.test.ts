import { describe, it, expect } from 'vitest';
import {
  appendMessage,
  completeRun,
  createRun,
  ensureRunsCollection,
  getRun,
  listRuns,
  abortRun,
  recordStepResult,
} from './runs.js';
import type { RunMessage, StepResult } from './types.js';

interface MockState {
  collection: boolean;
  rows: Record<string, unknown>[];
}

function pbMock(): { fetch: typeof fetch; state: MockState } {
  const state: MockState = { collection: false, rows: [] };
  let nextId = 1;
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const notFound = () => new Response('{"code":404}', { status: 404 });

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const u = new URL(url);
    const path = u.pathname;
    const search = u.search;

    if (path === '/api/collections/wp_weavers_tension_runs' && method === 'GET') {
      return state.collection ? ok({ name: 'wp_weavers_tension_runs' }) : notFound();
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_weavers_tension_runs') state.collection = true;
      return ok({ name: body.name });
    }
    if (path === '/api/collections/wp_weavers_tension_runs/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `r${nextId++}`, ...body };
      state.rows.push(row);
      return ok(row);
    }
    if (path === '/api/collections/wp_weavers_tension_runs/records' && method === 'GET') {
      const params = new URLSearchParams(search);
      const filter = params.get('filter') ?? '';
      let items = state.rows;
      const m = filter.match(/run_id = "([^"]+)"/);
      if (m) {
        items = items.filter((r) => r['run_id'] === m[1]);
      }
      const sm = filter.match(/scenario_slug = "([^"]+)"/);
      if (sm) {
        items = items.filter((r) => r['scenario_slug'] === sm[1]);
      }
      return ok({ items, totalItems: items.length });
    }
    if (
      path.match(/^\/api\/collections\/wp_weavers_tension_runs\/records\/r\d+$/) &&
      method === 'PATCH'
    ) {
      const id = path.split('/').pop()!;
      const idx = state.rows.findIndex((r) => r['id'] === id);
      if (idx < 0) return notFound();
      const patch = JSON.parse(init?.body as string) as Record<string, unknown>;
      state.rows[idx] = { ...state.rows[idx], ...patch };
      return ok(state.rows[idx]);
    }

    return new Response('not mocked: ' + path, { status: 500 });
  }) as typeof fetch;

  return { fetch: fetchFn, state };
}

describe('weavers-tension runs', () => {
  it('ensures the collection', async () => {
    const pb = pbMock();
    const r = await ensureRunsCollection(pb.fetch, 'tok');
    expect(r.ok).toBe(true);
    expect(pb.state.collection).toBe(true);
  });

  it('creates a run with empty messages, results, answers', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    const created = await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'demo',
      opId: 'op-abc',
      actor: { kind: 'wizard', id: 'wiz-1', email: 'wiz@test' },
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.run.scenarioSlug).toBe('demo');
      expect(created.run.opId).toBe('op-abc');
      expect(created.run.status).toBe('in-progress');
      expect(created.run.currentStepIndex).toBe(0);
      expect(created.run.messages).toEqual([]);
      expect(created.run.stepResults).toEqual([]);
    }
  });

  it('appends messages and advances steps', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    const created = await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'demo',
      opId: 'op-abc',
      actor: { kind: 'wizard', id: 'wiz-1' },
    });
    if (!created.ok) throw new Error('failed to create');
    const msg: RunMessage = {
      id: 'm1',
      ts: '2026-05-12T00:00:00Z',
      authorKind: 'wizard',
      authorId: 'wiz-1',
      stepRef: 'one',
      body: 'first thought',
    };
    const withMessage = await appendMessage(pb.fetch, 'tok', created.run, msg);
    expect(withMessage.ok).toBe(true);
    if (withMessage.ok) {
      expect(withMessage.run.messages).toHaveLength(1);
      expect(withMessage.run.messages[0]?.body).toBe('first thought');
    }

    const result: StepResult = {
      stepKey: 'one',
      status: 'approved',
      recordedAt: '2026-05-12T00:00:01Z',
    };
    const advanced = await recordStepResult(
      pb.fetch,
      'tok',
      withMessage.ok ? withMessage.run : created.run,
      result,
    );
    expect(advanced.ok).toBe(true);
    if (advanced.ok) {
      expect(advanced.run.currentStepIndex).toBe(1);
      expect(advanced.run.stepResults).toHaveLength(1);
    }
  });

  it('records answers from a prompt-input step', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    const created = await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'demo',
      opId: 'op-abc',
      actor: { kind: 'wizard', id: 'wiz-1' },
    });
    if (!created.ok) throw new Error('failed');
    const advanced = await recordStepResult(
      pb.fetch,
      'tok',
      created.run,
      { stepKey: 'fill', status: 'approved', recordedAt: '2026-05-12T00:00:00Z' },
      { newSpinner: { slug: 'tension-demo', displayName: 'Tension Demo' } },
    );
    expect(advanced.ok).toBe(true);
    if (advanced.ok) {
      expect(advanced.run.answers['newSpinner']?.['slug']).toBe('tension-demo');
    }
  });

  it('completes a run and stamps endedAt', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    const created = await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'demo',
      opId: 'op-abc',
      actor: { kind: 'wizard', id: 'wiz-1' },
    });
    if (!created.ok) throw new Error('failed');
    const done = await completeRun(pb.fetch, 'tok', created.run);
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.run.status).toBe('completed');
      expect(done.run.endedAt).toBeTruthy();
    }
  });

  it('aborts a run', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    const created = await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'demo',
      opId: 'op-abc',
      actor: { kind: 'wizard', id: 'wiz-1' },
    });
    if (!created.ok) throw new Error('failed');
    const stopped = await abortRun(pb.fetch, 'tok', created.run);
    expect(stopped.ok).toBe(true);
    if (stopped.ok) expect(stopped.run.status).toBe('aborted');
  });

  it('looks up an existing run by runId', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    const created = await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'demo',
      opId: 'op-abc',
      actor: { kind: 'wizard', id: 'wiz-1' },
    });
    if (!created.ok) throw new Error('failed');
    const got = await getRun(pb.fetch, 'tok', created.run.runId);
    expect(got.ok).toBe(true);
    if (got.ok && got.run) expect(got.run.runId).toBe(created.run.runId);
  });

  it('returns null for an unknown runId', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    const got = await getRun(pb.fetch, 'tok', 'nope');
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.run).toBeNull();
  });

  it('lists runs filtered by scenario', async () => {
    const pb = pbMock();
    await ensureRunsCollection(pb.fetch, 'tok');
    await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'a',
      opId: 'op-1',
      actor: { kind: 'wizard', id: 'w' },
    });
    await createRun(pb.fetch, 'tok', {
      scenarioSlug: 'b',
      opId: 'op-2',
      actor: { kind: 'wizard', id: 'w' },
    });
    const l = await listRuns(pb.fetch, 'tok', { scenarioSlug: 'a' });
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.runs).toHaveLength(1);
      expect(l.runs[0]?.scenarioSlug).toBe('a');
    }
  });
});
