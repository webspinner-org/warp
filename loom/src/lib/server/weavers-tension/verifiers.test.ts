import { describe, it, expect } from 'vitest';
import { runVerifier } from './verifiers.js';

function makeFetch(routes: Record<string, (init?: RequestInit) => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${u.pathname}${u.search}`;
    const exact = routes[key];
    if (exact) return exact(init);
    // Fall back to path-only match.
    const pathKey = `${init?.method ?? 'GET'} ${u.pathname}`;
    const path = routes[pathKey];
    if (path) return path(init);
    return new Response('not mocked: ' + key, { status: 500 });
  }) as typeof fetch;
}

describe('runVerifier', () => {
  it('route-status: passes on expected status + body contains', async () => {
    const f = makeFetch({
      'GET /admin/spinners': () =>
        new Response('<html>Skein listing — New Spinner here</html>', { status: 200 }),
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: {
        kind: 'route-status',
        path: '/admin/spinners',
        expectStatus: 200,
        bodyContains: ['New Spinner'],
      },
      answers: {},
      loomBaseOverride: 'http://test',
    });
    expect(r.ok).toBe(true);
    expect(r.evidence['bodyContainsMissing']).toEqual([]);
  });

  it('route-status: fails when body is missing required substring', async () => {
    const f = makeFetch({
      'GET /admin/spinners': () => new Response('<html>nope</html>', { status: 200 }),
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: {
        kind: 'route-status',
        path: '/admin/spinners',
        expectStatus: 200,
        bodyContains: ['New Spinner'],
      },
      answers: {},
      loomBaseOverride: 'http://test',
    });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('body missing');
  });

  it('route-status: substitutes answer placeholders in path', async () => {
    const captured: string[] = [];
    const f = makeFetch({
      'GET /admin/spinners/tension-demo': () => {
        captured.push('hit');
        return new Response('ok', { status: 200 });
      },
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: { kind: 'route-status', path: '/admin/spinners/{{answer.newSpinner.slug}}' },
      answers: { newSpinner: { slug: 'tension-demo' } },
      loomBaseOverride: 'http://test',
    });
    expect(r.ok).toBe(true);
    expect(captured).toEqual(['hit']);
  });

  it('pb-row-exists: passes when a matching row exists and asserts match', async () => {
    const f = makeFetch({
      'GET /api/collections/wp_skein/records': () =>
        new Response(
          JSON.stringify({
            items: [{ id: 'r1', slug: 'tension-demo', integrity_status: 'verified' }],
          }),
          { status: 200 },
        ),
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: {
        kind: 'pb-row-exists',
        collection: 'wp_skein',
        filter: 'slug = "{{answer.newSpinner.slug}}"',
        assertFields: { integrity_status: 'verified' },
      },
      answers: { newSpinner: { slug: 'tension-demo' } },
    });
    expect(r.ok).toBe(true);
  });

  it('pb-row-exists: defers when placeholders unresolved', async () => {
    const f = makeFetch({});
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: {
        kind: 'pb-row-exists',
        collection: 'wp_skein',
        filter: 'slug = "{{answer.newSpinner.slug}}"',
      },
      answers: {},
    });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('unresolved placeholder');
  });

  it('pb-row-exists: fails when assertFields mismatch', async () => {
    const f = makeFetch({
      'GET /api/collections/wp_skein/records': () =>
        new Response(
          JSON.stringify({
            items: [{ id: 'r1', slug: 'x', integrity_status: 'unsigned' }],
          }),
          { status: 200 },
        ),
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: {
        kind: 'pb-row-exists',
        collection: 'wp_skein',
        filter: 'slug = "x"',
        assertFields: { integrity_status: 'verified' },
      },
      answers: {},
    });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('field assert');
  });

  it('audit-event: passes when an event is found', async () => {
    const f = makeFetch({
      'GET /api/collections/wp_audit/records': () =>
        new Response(
          JSON.stringify({
            items: [
              { id: 'a1', event_type: 'wp.spinner.install', event_time: new Date().toISOString() },
            ],
            totalItems: 1,
          }),
          { status: 200 },
        ),
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: { kind: 'audit-event', eventType: 'wp.spinner.install', windowSec: 120 },
      answers: {},
    });
    expect(r.ok).toBe(true);
  });

  it('audit-event: fails when no event is found', async () => {
    const f = makeFetch({
      'GET /api/collections/wp_audit/records': () =>
        new Response(JSON.stringify({ items: [], totalItems: 0 }), { status: 200 }),
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: { kind: 'audit-event', eventType: 'wp.spinner.install' },
      answers: {},
    });
    expect(r.ok).toBe(false);
  });

  it('op-envelope: passes when an op of the right kind+status is found', async () => {
    const f = makeFetch({
      'GET /api/collections/wp_operations/records': () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'o1',
                kind: 'spinner.install',
                status: 'ok',
                started_at: new Date().toISOString(),
              },
            ],
            totalItems: 1,
          }),
          { status: 200 },
        ),
    });
    const r = await runVerifier({
      fetch: f,
      pbToken: 'tok',
      verifier: { kind: 'op-envelope', opKind: 'spinner.install', status: 'ok' },
      answers: {},
    });
    expect(r.ok).toBe(true);
  });
});
