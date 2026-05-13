/**
 * Orchestration tests for `lintSpinnerBundleOp`. Uses an on-disk tmpdir
 * copy of Pablo + an in-memory PocketBase mock to cover the full flow
 * (path validation, schema check, file presence, wp_operations row,
 * wp_audit event).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, cp, stat, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { lintSpinnerBundleOp } from './spinner-lint-op.js';

const PABLO_DIR = resolve(process.env['HOME'] ?? '~', 'warp/spinners/pablo');
const FIXED_NOW = (): Date => new Date('2026-05-12T17:00:00.000Z');

async function pabloExists(): Promise<boolean> {
  try {
    const s = await stat(PABLO_DIR);
    return s.isDirectory();
  } catch {
    return false;
  }
}

const stagedDirs: string[] = [];
afterEach(async () => {
  for (const dir of stagedDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

async function stageBundle(): Promise<string> {
  const root = resolve(process.env['HOME'] ?? '~', 'warp/spinners');
  const dir = await mkdtemp(join(root, '.test-lint-op-'));
  stagedDirs.push(dir);
  await cp(PABLO_DIR, dir, { recursive: true });
  return dir;
}

interface PbState {
  identityCollection: boolean;
  identityRows: { id: string; public_key_hex: string; fingerprint: string; created_at: string }[];
  operationsCollection: boolean;
  operationsRows: Record<string, unknown>[];
  auditCollection: boolean;
  auditRows: Record<string, unknown>[];
}

function pbMock(): { fetch: typeof fetch; state: PbState } {
  const state: PbState = {
    identityCollection: false,
    identityRows: [],
    operationsCollection: false,
    operationsRows: [],
    auditCollection: false,
    auditRows: [],
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

    if (path === '/api/collections/wp_cell_identity' && method === 'GET') {
      return state.identityCollection ? ok({ name: 'wp_cell_identity' }) : notFound();
    }
    if (path === '/api/collections/wp_operations' && method === 'GET') {
      return state.operationsCollection ? ok({ name: 'wp_operations' }) : notFound();
    }
    if (path === '/api/collections/wp_audit' && method === 'GET') {
      return state.auditCollection ? ok({ name: 'wp_audit' }) : notFound();
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_cell_identity') state.identityCollection = true;
      if (body.name === 'wp_operations') state.operationsCollection = true;
      if (body.name === 'wp_audit') state.auditCollection = true;
      return ok({ name: body.name });
    }
    if (path === '/api/collections/wp_cell_identity/records' && method === 'GET') {
      return ok({ items: state.identityRows.slice(0, 1) });
    }
    if (path === '/api/collections/wp_operations/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.operationsRows.push(row);
      return ok(row);
    }
    if (path === '/api/collections/wp_audit/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.auditRows.push(row);
      return ok(row);
    }
    return notFound();
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

describe('lintSpinnerBundleOp', async () => {
  const hasPablo = await pabloExists();

  it.skipIf(!hasPablo)('happy path: lints Pablo, writes op + audit rows', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const result = await lintSpinnerBundleOp({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz', email: 'wiz@test' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(true);
    expect(result.value.opId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.value.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.bundleStats.capabilityCount).toBeGreaterThanOrEqual(1);

    // wp_operations row.
    expect(pb.state.operationsRows).toHaveLength(1);
    const opRow = pb.state.operationsRows[0]!;
    expect(opRow['kind']).toBe('spinner.lint');
    expect(['ok', 'partial']).toContain(opRow['status'] as string);

    // wp_audit row.
    expect(pb.state.auditRows).toHaveLength(1);
    const auditRow = pb.state.auditRows[0]!;
    expect(auditRow['event_type']).toBe('wp.spinner.linted');
    expect(auditRow['audit_result']).toBe('success');
    expect(auditRow['correlation_id']).toBe(opRow['op_id']);
    expect(auditRow['ocsf_class']).toBe(6003);
  });

  it('path-not-allowed is denied + op row + audit row', async () => {
    const pb = pbMock();
    const result = await lintSpinnerBundleOp({
      bundlePath: '/etc/passwd',
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('path-not-allowed');
    expect(pb.state.operationsRows[0]?.['status']).toBe('failed');
    expect(pb.state.auditRows[0]?.['audit_result']).toBe('denied');
  });

  it.skipIf(!hasPablo)('bundle-not-found is failed', async () => {
    const pb = pbMock();
    const fakeDir = resolve(process.env['HOME'] ?? '~', 'warp/spinners/this-does-not-exist-789');
    const result = await lintSpinnerBundleOp({
      bundlePath: fakeDir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('bundle-not-found');
  });

  it.skipIf(!hasPablo)('malformed manifest is reported with manifest-invalid', async () => {
    const dir = await stageBundle();
    await writeFile(join(dir, 'manifest.json'), '{not json', 'utf8');
    const pb = pbMock();
    const result = await lintSpinnerBundleOp({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('manifest-invalid');
    expect(pb.state.auditRows[0]?.['audit_result']).toBe('error');
  });

  it.skipIf(!hasPablo)('lint errors are surfaced on the op output (status: partial)', async () => {
    // Stage Pablo, mutate the manifest to remove a required field.
    const dir = await stageBundle();
    const manifestPath = join(dir, 'manifest.json');
    const raw = await import('node:fs/promises').then((m) => m.readFile(manifestPath, 'utf8'));
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    delete manifest['description']; // schema-required
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const pb = pbMock();
    const result = await lintSpinnerBundleOp({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(false);
    expect(result.value.errorCount).toBeGreaterThanOrEqual(1);
    // operations status: partial (op completed but bundle is invalid).
    expect(pb.state.operationsRows[0]?.['status']).toBe('partial');
    // audit: error.
    expect(pb.state.auditRows[0]?.['audit_result']).toBe('error');
  });

  it.skipIf(!hasPablo)('two concurrent lints write distinct op_ids', async () => {
    const dirA = await stageBundle();
    const dirB = await stageBundle();
    const pb = pbMock();
    const [a, b] = await Promise.all([
      lintSpinnerBundleOp({
        bundlePath: dirA,
        actor: { kind: 'wizard', id: 'op-1' },
        fetch: pb.fetch,
        pbToken: 'tok',
        now: FIXED_NOW,
      }),
      lintSpinnerBundleOp({
        bundlePath: dirB,
        actor: { kind: 'wizard', id: 'op-2' },
        fetch: pb.fetch,
        pbToken: 'tok',
        now: FIXED_NOW,
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.opId).not.toBe(b.value.opId);
  });
});
