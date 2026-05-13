import { describe, it, expect } from 'vitest';
import { listAuditEvents } from './audit.js';

interface SeedRow {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly event_source: string;
  readonly event_subject: string;
  readonly event_time: string;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly actor_display_name: string;
  readonly audit_result: string;
  readonly audit_reason: string;
  readonly correlation_id: string;
  readonly ocsf_class: number;
  readonly data: Record<string, unknown> | null;
  readonly created: string;
  readonly updated: string;
}

function row(over: Partial<SeedRow>): SeedRow {
  return {
    id: 'r-' + Math.random().toString(36).slice(2, 8),
    event_id: 'e-' + Math.random().toString(36).slice(2, 8),
    event_type: 'wp.spinner.signed',
    event_source: 'urn:webspinner:cell:test',
    event_subject: '@webspinner-foundation/pablo',
    event_time: '2026-05-12T17:00:00.000Z',
    actor_kind: 'human',
    actor_id: 'wiz@test',
    actor_display_name: 'wiz@test',
    audit_result: 'success',
    audit_reason: 'fixture',
    correlation_id: 'op-uuid-1',
    ocsf_class: 6003,
    data: null,
    created: '2026-05-12T17:00:00.000Z',
    updated: '2026-05-12T17:00:00.000Z',
    ...over,
  };
}

function pbMock(seedRows: readonly SeedRow[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    if (u.pathname !== '/api/collections/wp_audit/records') {
      return new Response('{"code":404}', { status: 404 });
    }
    const filter = u.searchParams.get('filter') ?? '';
    let rows = [...seedRows];

    const corrMatch = /correlation_id = "([^"]+)"/.exec(filter);
    if (corrMatch) rows = rows.filter((r) => r.correlation_id === corrMatch[1]);

    const typeMatch = /event_type = "([^"]+)"/.exec(filter);
    if (typeMatch) rows = rows.filter((r) => r.event_type === typeMatch[1]);

    const resultMatch = /audit_result = "([^"]+)"/.exec(filter);
    if (resultMatch) rows = rows.filter((r) => r.audit_result === resultMatch[1]);

    return new Response(JSON.stringify({ items: rows, totalItems: rows.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('listAuditEvents — correlationId filter', () => {
  it('returns only the rows matching correlation_id', async () => {
    const rows: SeedRow[] = [
      row({ correlation_id: 'op-A', event_type: 'wp.spinner.signed' }),
      row({ correlation_id: 'op-B', event_type: 'wp.spinner.verified' }),
      row({ correlation_id: 'op-A', event_type: 'wp.spinner.verified' }),
    ];
    const fetchFn = pbMock(rows);
    const r = await listAuditEvents(fetchFn, 'tok', { correlationId: 'op-A' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(2);
    for (const e of r.events) expect(e.correlation_id).toBe('op-A');
  });

  it('returns empty when no rows match', async () => {
    const fetchFn = pbMock([row({ correlation_id: 'op-X' })]);
    const r = await listAuditEvents(fetchFn, 'tok', { correlationId: 'op-Y' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(0);
  });

  it('combines correlationId with other filters via PB && syntax', async () => {
    const rows: SeedRow[] = [
      row({ correlation_id: 'op-A', event_type: 'wp.spinner.signed' }),
      row({ correlation_id: 'op-A', event_type: 'wp.spinner.verified' }),
    ];
    const fetchFn = pbMock(rows);
    const r = await listAuditEvents(fetchFn, 'tok', {
      correlationId: 'op-A',
      eventType: 'wp.spinner.signed',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.event_type).toBe('wp.spinner.signed');
  });
});
