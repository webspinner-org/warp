import { describe, it, expect } from 'vitest';
import { writeOperation, ensureOperationsCollection } from './operations.js';

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

    if (path === '/api/collections/wp_operations' && method === 'GET') {
      return state.collection ? ok({ name: 'wp_operations' }) : notFound();
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_operations') state.collection = true;
      return ok({ name: body.name });
    }
    if (path === '/api/collections/wp_operations/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.rows.push(row);
      return ok(row);
    }
    return notFound();
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

describe('operations log', () => {
  it('ensureOperationsCollection is idempotent', async () => {
    const pb = pbMock();
    const a = await ensureOperationsCollection(pb.fetch, 'tok');
    const b = await ensureOperationsCollection(pb.fetch, 'tok');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(pb.state.collection).toBe(true);
  });

  it('writeOperation persists the row with assigned op_id', async () => {
    const pb = pbMock();
    const result = await writeOperation(pb.fetch, 'tok', {
      kind: 'spinner.sign',
      status: 'ok',
      startedAt: '2026-05-12T17:00:00.000Z',
      endedAt: '2026-05-12T17:00:00.300Z',
      actor: { kind: 'wizard', id: 'op-1', email: 'wiz@example.com' },
      input: { bundlePath: '~/warp/spinners/pablo' },
      output: { digest: 'sha256:abc' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.opId).toMatch(/^[0-9a-f-]{36}$/);
    expect(pb.state.rows).toHaveLength(1);
    const row = pb.state.rows[0]!;
    expect(row['kind']).toBe('spinner.sign');
    expect(row['status']).toBe('ok');
    expect(row['actor_kind']).toBe('wizard');
    expect(row['actor_email']).toBe('wiz@example.com');
  });

  it('writeOperation captures error rows with kind + message', async () => {
    const pb = pbMock();
    const result = await writeOperation(pb.fetch, 'tok', {
      kind: 'spinner.verify',
      status: 'failed',
      startedAt: '2026-05-12T17:00:00.000Z',
      endedAt: '2026-05-12T17:00:00.300Z',
      actor: { kind: 'wizard', id: 'op-1' },
      input: { bundlePath: '~/warp/spinners/pablo' },
      error: { kind: 'digest-mismatch', message: 'recomputed does not match recorded' },
    });
    expect(result.ok).toBe(true);
    const row = pb.state.rows[0]!;
    expect(row['error_kind']).toBe('digest-mismatch');
    expect(row['error_message']).toBe('recomputed does not match recorded');
  });

  it('writeOperation surfaces parentOpId when set (for nested ops)', async () => {
    const pb = pbMock();
    const result = await writeOperation(pb.fetch, 'tok', {
      kind: 'spinner.sign',
      status: 'ok',
      startedAt: '2026-05-12T17:00:00.000Z',
      endedAt: '2026-05-12T17:00:00.300Z',
      actor: { kind: 'meta-runtime', id: 'authoring' },
      input: { bundlePath: '...' },
      parentOpId: 'parent-op-uuid-here',
    });
    expect(result.ok).toBe(true);
    const row = pb.state.rows[0]!;
    expect(row['parent_op_id']).toBe('parent-op-uuid-here');
  });

  it('two writes produce distinct op_ids', async () => {
    const pb = pbMock();
    const a = await writeOperation(pb.fetch, 'tok', {
      kind: 'spinner.sign',
      status: 'ok',
      startedAt: '2026-05-12T17:00:00.000Z',
      endedAt: '2026-05-12T17:00:00.300Z',
      actor: { kind: 'wizard', id: 'op-1' },
      input: {},
    });
    const b = await writeOperation(pb.fetch, 'tok', {
      kind: 'spinner.sign',
      status: 'ok',
      startedAt: '2026-05-12T17:00:00.000Z',
      endedAt: '2026-05-12T17:00:00.300Z',
      actor: { kind: 'wizard', id: 'op-1' },
      input: {},
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.row.opId).not.toBe(b.row.opId);
  });
});
