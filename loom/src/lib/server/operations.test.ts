import { describe, it, expect } from 'vitest';
import {
  writeOperation,
  ensureOperationsCollection,
  listOperations,
  getOperation,
} from './operations.js';

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
    if (path === '/api/collections/wp_operations/records' && method === 'GET') {
      // Minimal PB-filter parsing: support op_id equality + sort by
      // started_at descending. This is just enough for the tests below.
      const u = new URL(url);
      const filter = u.searchParams.get('filter') ?? '';
      let rows = [...state.rows];
      const opIdMatch = /op_id = "([^"]+)"/.exec(filter);
      if (opIdMatch) {
        rows = rows.filter((r) => r['op_id'] === opIdMatch[1]);
      }
      const kindMatch = filter.match(/kind = "([^"]+)"/g);
      if (kindMatch) {
        const kinds = kindMatch.map((m) => /kind = "([^"]+)"/.exec(m)?.[1] ?? '');
        rows = rows.filter((r) => kinds.includes(r['kind'] as string));
      }
      const statusMatch = filter.match(/status = "([^"]+)"/g);
      if (statusMatch) {
        const statuses = statusMatch.map((m) => /status = "([^"]+)"/.exec(m)?.[1] ?? '');
        rows = rows.filter((r) => statuses.includes(r['status'] as string));
      }
      // Sort by started_at descending.
      rows.sort((a, b) => String(b['started_at']).localeCompare(String(a['started_at'])));
      const perPage = Math.min(200, Number(u.searchParams.get('perPage') ?? 50));
      return ok({ items: rows.slice(0, perPage) });
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

describe('listOperations + getOperation', () => {
  async function seedRows(): Promise<{ pb: ReturnType<typeof pbMock>; opIds: string[] }> {
    const pb = pbMock();
    const opIds: string[] = [];
    const fixtures = [
      { kind: 'spinner.sign' as const, status: 'ok' as const, started: '2026-05-12T17:00:00.000Z' },
      {
        kind: 'spinner.verify' as const,
        status: 'partial' as const,
        started: '2026-05-12T17:05:00.000Z',
      },
      {
        kind: 'spinner.sign' as const,
        status: 'failed' as const,
        started: '2026-05-12T17:10:00.000Z',
      },
    ];
    for (const f of fixtures) {
      const r = await writeOperation(pb.fetch, 'tok', {
        kind: f.kind,
        status: f.status,
        startedAt: f.started,
        endedAt: f.started,
        actor: { kind: 'wizard', id: 'op-1', email: 'wiz@test' },
        input: { bundlePath: '~/warp/spinners/x' },
      });
      if (r.ok) opIds.push(r.row.opId);
    }
    return { pb, opIds };
  }

  it('returns all rows sorted by started_at descending when no filters', async () => {
    const { pb } = await seedRows();
    const r = await listOperations(pb.fetch, 'tok', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(3);
    // Most recent first.
    expect(r.rows[0]?.startedAt).toBe('2026-05-12T17:10:00.000Z');
    expect(r.rows[2]?.startedAt).toBe('2026-05-12T17:00:00.000Z');
  });

  it('filters by kind', async () => {
    const { pb } = await seedRows();
    const r = await listOperations(pb.fetch, 'tok', { kinds: ['spinner.sign'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) expect(row.kind).toBe('spinner.sign');
  });

  it('filters by status', async () => {
    const { pb } = await seedRows();
    const r = await listOperations(pb.fetch, 'tok', { statuses: ['failed'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.status).toBe('failed');
  });

  it('parses input/output/error/actor.email into typed shape', async () => {
    const { pb } = await seedRows();
    const r = await listOperations(pb.fetch, 'tok', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = r.rows[0]!;
    expect(row.actor.email).toBe('wiz@test');
    expect(row.input).toEqual({ bundlePath: '~/warp/spinners/x' });
    expect(row.error).toBeNull(); // none of the seed rows have errors
  });

  it('getOperation returns the row for a known op_id', async () => {
    const { pb, opIds } = await seedRows();
    const target = opIds[1]!;
    const r = await getOperation(pb.fetch, 'tok', target);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).not.toBeNull();
    expect(r.row?.opId).toBe(target);
    expect(r.row?.kind).toBe('spinner.verify');
    expect(r.row?.status).toBe('partial');
  });

  it('getOperation returns row:null for an unknown op_id', async () => {
    const { pb } = await seedRows();
    const r = await getOperation(pb.fetch, 'tok', 'not-a-real-uuid');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toBeNull();
  });
});
