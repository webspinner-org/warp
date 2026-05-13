import { describe, it, expect } from 'vitest';
import {
  ensureSkeinCollection,
  listSkein,
  getSkein,
  upsertSkeinRow,
  updateIntegrityStatus,
  deleteSkeinRow,
  classifySource,
  type SkeinUpsert,
  type SkeinSigner,
} from './skein.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { SpinnerName } from '@webspinner-foundation/sdk';

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
    const u = new URL(url);
    const path = u.pathname;
    const search = u.search;

    if (path === '/api/collections/wp_skein' && method === 'GET') {
      return state.collection ? ok({ name: 'wp_skein' }) : notFound();
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_skein') state.collection = true;
      return ok({ name: body.name });
    }
    if (path === '/api/collections/wp_skein/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.rows.push(row);
      return ok(row);
    }
    if (path === '/api/collections/wp_skein/records' && method === 'GET') {
      const filter = new URLSearchParams(search).get('filter') ?? '';
      let rows = [...state.rows];
      const slugMatch = /slug = "([^"]+)"/.exec(filter);
      if (slugMatch) rows = rows.filter((r) => r['slug'] === slugMatch[1]);
      const sourceMatches = filter.match(/source = "([^"]+)"/g);
      if (sourceMatches) {
        const sources = sourceMatches.map((m) => /source = "([^"]+)"/.exec(m)?.[1] ?? '');
        rows = rows.filter((r) => sources.includes(r['source'] as string));
      }
      const integrityMatches = filter.match(/integrity_status = "([^"]+)"/g);
      if (integrityMatches) {
        const statuses = integrityMatches.map(
          (m) => /integrity_status = "([^"]+)"/.exec(m)?.[1] ?? '',
        );
        rows = rows.filter((r) => statuses.includes(r['integrity_status'] as string));
      }
      rows.sort((a, b) =>
        String(b['installed_at'] ?? '').localeCompare(String(a['installed_at'] ?? '')),
      );
      return ok({ items: rows });
    }
    // PATCH a row.
    const recordMatch = /^\/api\/collections\/wp_skein\/records\/(.+)$/.exec(path);
    if (recordMatch && (method === 'PATCH' || method === 'DELETE')) {
      const id = recordMatch[1]!;
      const idx = state.rows.findIndex((r) => r['id'] === id);
      if (idx < 0) return notFound();
      if (method === 'DELETE') {
        state.rows.splice(idx, 1);
        return ok({});
      }
      const patch = JSON.parse(init?.body as string) as Record<string, unknown>;
      state.rows[idx] = { ...state.rows[idx]!, ...patch };
      return ok(state.rows[idx]!);
    }
    return notFound();
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

function fixtureUpsert(slug = 'pablo', overrides: Partial<SkeinUpsert> = {}): SkeinUpsert {
  return {
    name: `@webspinner-foundation/${slug}` as SpinnerName,
    slug,
    version: '1.0.0',
    bundlePath: `~/warp/spinners/${slug}`,
    source: 'genesis',
    recordedDigest: 'sha256:' + 'a'.repeat(64),
    signers: [
      {
        fingerprint: 'a'.repeat(16),
        signerLabel: 'cell-identity-key',
        signedAt: '2026-05-12T17:00:00.000Z',
      },
    ],
    integrityStatus: 'verified',
    lastIntegrityCheck: '2026-05-12T17:00:00.000Z',
    installedAt: '2026-05-12T17:00:00.000Z',
    installedBy: 'test-wiz',
    ...overrides,
  };
}

describe('wp_skein collection lifecycle', () => {
  it('ensureSkeinCollection is idempotent', async () => {
    const pb = pbMock();
    expect((await ensureSkeinCollection(pb.fetch, 'tok')).ok).toBe(true);
    expect((await ensureSkeinCollection(pb.fetch, 'tok')).ok).toBe(true);
    expect(pb.state.collection).toBe(true);
  });

  it('upsertSkeinRow creates on first call, PATCHes on second', async () => {
    const pb = pbMock();
    const first = await upsertSkeinRow(pb.fetch, 'tok', fixtureUpsert('pablo'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(pb.state.rows).toHaveLength(1);
    expect(first.row.invocationCount).toBe(0);

    const second = await upsertSkeinRow(
      pb.fetch,
      'tok',
      fixtureUpsert('pablo', { version: '1.0.1' }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(pb.state.rows).toHaveLength(1);
    expect(second.row.version).toBe('1.0.1');
  });

  it('getSkein returns row for known slug, null for unknown', async () => {
    const pb = pbMock();
    await upsertSkeinRow(pb.fetch, 'tok', fixtureUpsert('pablo'));
    const got = await getSkein(pb.fetch, 'tok', 'pablo');
    expect(got.ok && got.row?.slug).toBe('pablo');
    const missing = await getSkein(pb.fetch, 'tok', 'no-such-spinner');
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.row).toBeNull();
  });

  it('listSkein returns all rows sorted by installed_at descending', async () => {
    const pb = pbMock();
    await upsertSkeinRow(
      pb.fetch,
      'tok',
      fixtureUpsert('pablo', { installedAt: '2026-05-12T17:00:00.000Z' }),
    );
    await upsertSkeinRow(
      pb.fetch,
      'tok',
      fixtureUpsert('bootstrap', { installedAt: '2026-05-12T18:00:00.000Z' }),
    );
    await upsertSkeinRow(
      pb.fetch,
      'tok',
      fixtureUpsert('genesis', { installedAt: '2026-05-12T16:00:00.000Z' }),
    );
    const r = await listSkein(pb.fetch, 'tok', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => x.slug)).toEqual(['bootstrap', 'pablo', 'genesis']);
  });

  it('listSkein filters by source', async () => {
    const pb = pbMock();
    await upsertSkeinRow(pb.fetch, 'tok', fixtureUpsert('pablo', { source: 'genesis' }));
    await upsertSkeinRow(pb.fetch, 'tok', fixtureUpsert('my-app', { source: 'cell-authored' }));
    const r = await listSkein(pb.fetch, 'tok', { sources: ['cell-authored'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.slug).toBe('my-app');
  });

  it('listSkein filters by integrity status', async () => {
    const pb = pbMock();
    await upsertSkeinRow(
      pb.fetch,
      'tok',
      fixtureUpsert('verified-spinner', { integrityStatus: 'verified' }),
    );
    await upsertSkeinRow(
      pb.fetch,
      'tok',
      fixtureUpsert('tampered', { integrityStatus: 'digest-mismatch' }),
    );
    const r = await listSkein(pb.fetch, 'tok', { integrityStatuses: ['digest-mismatch'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.slug).toBe('tampered');
  });

  it('updateIntegrityStatus changes only status + lastIntegrityCheck', async () => {
    const pb = pbMock();
    await upsertSkeinRow(pb.fetch, 'tok', fixtureUpsert('pablo'));
    const updated = await updateIntegrityStatus(
      pb.fetch,
      'tok',
      'pablo',
      'digest-mismatch',
      '2026-05-12T18:00:00.000Z',
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.row.integrityStatus).toBe('digest-mismatch');
    expect(updated.row.lastIntegrityCheck).toBe('2026-05-12T18:00:00.000Z');
    expect(updated.row.version).toBe('1.0.0'); // unchanged
  });

  it('updateIntegrityStatus returns 404 for unknown slug', async () => {
    const pb = pbMock();
    const r = await updateIntegrityStatus(
      pb.fetch,
      'tok',
      'no-such',
      'verified',
      '2026-05-12T18:00:00.000Z',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
  });

  it('deleteSkeinRow removes the row and is idempotent', async () => {
    const pb = pbMock();
    await upsertSkeinRow(pb.fetch, 'tok', fixtureUpsert('pablo'));
    expect(pb.state.rows).toHaveLength(1);
    expect((await deleteSkeinRow(pb.fetch, 'tok', 'pablo')).ok).toBe(true);
    expect(pb.state.rows).toHaveLength(0);
    // second delete is a no-op
    expect((await deleteSkeinRow(pb.fetch, 'tok', 'pablo')).ok).toBe(true);
  });
});

describe('classifySource', () => {
  const warpRoot = resolve(homedir(), 'warp/spinners');
  const cellsRoot = resolve(homedir(), 'Cells/spinners');
  const cellFp = 'c'.repeat(16);

  function makeSigner(over: Partial<SkeinSigner> = {}): SkeinSigner {
    return {
      fingerprint: 'a'.repeat(16),
      signerLabel: 'cell-identity-key',
      signedAt: '2026-05-12T17:00:00.000Z',
      ...over,
    };
  }

  it('classifies ~/warp/spinners/* as genesis', () => {
    expect(classifySource(`${warpRoot}/pablo`, [], null)).toBe('genesis');
  });

  it('classifies ~/Cells/spinners/* signed by local Cell as cell-authored', () => {
    const signers = [makeSigner({ fingerprint: cellFp })];
    expect(classifySource(`${cellsRoot}/my-app`, signers, cellFp)).toBe('cell-authored');
  });

  it('classifies ~/Cells/spinners/* signed by other Cell as third-party', () => {
    const signers = [makeSigner({ fingerprint: 'b'.repeat(16) })];
    expect(classifySource(`${cellsRoot}/foreign-app`, signers, cellFp)).toBe('third-party');
  });

  it('classifies bundles with Foundation release key as foundation-recognized', () => {
    const signers = [makeSigner({ signerLabel: 'foundation-release-key' })];
    expect(classifySource(`${warpRoot}/anywhere`, signers, cellFp)).toBe('foundation-recognized');
  });

  it('classifies arbitrary paths as third-party', () => {
    expect(classifySource('/tmp/random', [], null)).toBe('third-party');
  });
});
