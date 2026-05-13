/**
 * Orchestration tests for `installSpinnerBundle`. Uses on-disk tmpdir
 * copies of Pablo + an in-memory PocketBase mock to exercise the
 * full install pipeline (lint → identity → sign → provenance →
 * wp_skein row → operations + audit).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, cp, stat, rm, writeFile, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { installSpinnerBundle } from './spinner-install-op.js';

const PABLO_DIR = resolve(process.env['HOME'] ?? '~', 'warp/spinners/pablo');
const TEST_MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
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
  const dir = await mkdtemp(join(root, '.test-install-op-'));
  stagedDirs.push(dir);
  await cp(PABLO_DIR, dir, { recursive: true });
  // The staged copy ships with Pablo's existing manifest.name. Tests
  // that need isolation can rewrite the manifest's `name`/`slug`.
  return dir;
}

interface PbState {
  identityCollection: boolean;
  identityRows: { id: string; public_key_hex: string; fingerprint: string; created_at: string }[];
  vaultRows: { id: string; name: string; ciphertext: string; iv: string }[];
  operationsCollection: boolean;
  operationsRows: Record<string, unknown>[];
  auditCollection: boolean;
  auditRows: Record<string, unknown>[];
  skeinCollection: boolean;
  skeinRows: Record<string, unknown>[];
}

function pbMock(): { fetch: typeof fetch; state: PbState } {
  const state: PbState = {
    identityCollection: false,
    identityRows: [],
    vaultRows: [],
    operationsCollection: false,
    operationsRows: [],
    auditCollection: false,
    auditRows: [],
    skeinCollection: false,
    skeinRows: [],
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

    // ── collection-exists checks ─────────────────────────────────
    if (path === '/api/collections/wp_cell_identity' && method === 'GET') {
      return state.identityCollection ? ok({ name: 'wp_cell_identity' }) : notFound();
    }
    if (path === '/api/collections/wp_operations' && method === 'GET') {
      return state.operationsCollection ? ok({ name: 'wp_operations' }) : notFound();
    }
    if (path === '/api/collections/wp_audit' && method === 'GET') {
      return state.auditCollection ? ok({ name: 'wp_audit' }) : notFound();
    }
    if (path === '/api/collections/wp_skein' && method === 'GET') {
      return state.skeinCollection ? ok({ name: 'wp_skein' }) : notFound();
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_cell_identity') state.identityCollection = true;
      if (body.name === 'wp_operations') state.operationsCollection = true;
      if (body.name === 'wp_audit') state.auditCollection = true;
      if (body.name === 'wp_skein') state.skeinCollection = true;
      return ok({ name: body.name });
    }

    // ── identity ─────────────────────────────────────────────────
    if (path === '/api/collections/wp_cell_identity/records' && method === 'GET') {
      return ok({ items: state.identityRows.slice(0, 1) });
    }
    if (path === '/api/collections/wp_cell_identity/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as {
        public_key_hex: string;
        fingerprint: string;
        created_at: string;
      };
      const row = { id: `id-${nextId++}`, ...body };
      state.identityRows.push(row);
      return ok(row);
    }

    // ── vault ────────────────────────────────────────────────────
    if (path === '/api/collections/vault_secrets/records' && method === 'GET') {
      const m =
        /filter=name%20%3D%20%22([^%]+)%22/.exec(search) ??
        /filter=name%20%3D%20"([^"]+)"/.exec(search);
      const filtered = m ? state.vaultRows.filter((r) => r.name === m[1]) : state.vaultRows;
      return ok({ items: filtered });
    }
    if (path === '/api/collections/vault_secrets/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as {
        name: string;
        ciphertext: string;
        iv: string;
      };
      const row = {
        id: `id-${nextId++}`,
        name: body.name,
        ciphertext: body.ciphertext,
        iv: body.iv,
      };
      state.vaultRows.push(row);
      return ok(row);
    }

    // ── operations + audit ───────────────────────────────────────
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

    // ── skein ────────────────────────────────────────────────────
    if (path === '/api/collections/wp_skein/records' && method === 'GET') {
      const filter = new URLSearchParams(search).get('filter') ?? '';
      const slugMatch = /slug = "([^"]+)"/.exec(filter);
      let rows = [...state.skeinRows];
      if (slugMatch) rows = rows.filter((r) => r['slug'] === slugMatch[1]);
      return ok({ items: rows });
    }
    if (path === '/api/collections/wp_skein/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.skeinRows.push(row);
      return ok(row);
    }
    const recordMatch = /^\/api\/collections\/wp_skein\/records\/(.+)$/.exec(path);
    if (recordMatch && method === 'PATCH') {
      const id = recordMatch[1]!;
      const idx = state.skeinRows.findIndex((r) => r['id'] === id);
      if (idx < 0) return notFound();
      const patch = JSON.parse(init?.body as string) as Record<string, unknown>;
      state.skeinRows[idx] = { ...state.skeinRows[idx]!, ...patch };
      return ok(state.skeinRows[idx]!);
    }

    return notFound();
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

describe('installSpinnerBundle', async () => {
  const hasPablo = await pabloExists();

  it.skipIf(!hasPablo)('happy path: signs, registers, writes op + audit', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const result = await installSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz', email: 'wiz@test' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.alreadySigned).toBe(false);
    expect(result.value.filesWritten).toHaveLength(3);
    expect(result.value.signerFingerprints).toHaveLength(1);
    expect(result.value.integrityStatus).toBe('verified');
    // Pablo's bundle path is under ~/warp/spinners/ (tmpdir inside it),
    // so source classifies as genesis.
    expect(result.value.source).toBe('genesis');

    // wp_skein row written.
    expect(pb.state.skeinRows).toHaveLength(1);
    const skein = pb.state.skeinRows[0]!;
    expect(skein['integrity_status']).toBe('verified');
    expect(skein['recorded_digest']).toBe(result.value.digest);

    // wp_operations + wp_audit captured.
    expect(pb.state.operationsRows).toHaveLength(1);
    expect(pb.state.operationsRows[0]?.['kind']).toBe('spinner.install');
    expect(pb.state.operationsRows[0]?.['status']).toBe('ok');
    expect(pb.state.auditRows).toHaveLength(1);
    expect(pb.state.auditRows[0]?.['event_type']).toBe('wp.spinner.install');
    expect(pb.state.auditRows[0]?.['correlation_id']).toBe(pb.state.operationsRows[0]?.['op_id']);
  });

  it.skipIf(!hasPablo)('idempotent: re-install PATCHes existing skein row', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const first = await installSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(first.ok).toBe(true);
    const second = await installSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Bundle is already signed from the first install — second install
    // detects this.
    expect(second.value.alreadySigned).toBe(true);
    expect(second.value.filesWritten).toHaveLength(0);
    expect(pb.state.skeinRows).toHaveLength(1);
    expect(pb.state.operationsRows).toHaveLength(2); // two attempts logged
  });

  it('path-not-allowed denies + records failed op', async () => {
    const pb = pbMock();
    const result = await installSpinnerBundle({
      bundlePath: '/etc/passwd',
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('path-not-allowed');
    expect(pb.state.operationsRows[0]?.['status']).toBe('failed');
    // No audit event on failure paths (no manifest to populate the
    // required data shape).
    expect(pb.state.auditRows).toHaveLength(0);
    expect(pb.state.skeinRows).toHaveLength(0);
  });

  it.skipIf(!hasPablo)('bundle-not-found is reported', async () => {
    const pb = pbMock();
    const fakeDir = resolve(process.env['HOME'] ?? '~', 'warp/spinners/this-does-not-exist-456');
    const result = await installSpinnerBundle({
      bundlePath: fakeDir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
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
    const result = await installSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('manifest-invalid');
  });

  it.skipIf(!hasPablo)('lint errors gate install (lint-failed)', async () => {
    const dir = await stageBundle();
    const manifestPath = join(dir, 'manifest.json');
    const raw = await import('node:fs/promises').then((m) => m.readFile(manifestPath, 'utf8'));
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    delete manifest['description']; // schema-required
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const pb = pbMock();
    const result = await installSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lint-failed');
    if (result.error.kind === 'lint-failed') {
      expect(result.error.errorCount).toBeGreaterThan(0);
      expect(result.error.findings.length).toBeGreaterThan(0);
    }
    // No wp_skein row written.
    expect(pb.state.skeinRows).toHaveLength(0);
  });

  it.skipIf(!hasPablo)('source classifies as genesis for ~/warp/spinners/', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const result = await installSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('genesis');
  });

  it.skipIf(!hasPablo)('audit data includes the manifest, digest, and signers', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const result = await installSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auditRow = pb.state.auditRows[0]!;
    const data = auditRow['data'] as Record<string, unknown>;
    expect(data['digest']).toBe(result.value.digest);
    expect((data['signers'] as string[])[0]).toBe(result.value.signerFingerprints[0]);
    const manifest = data['manifest'] as { name: string };
    expect(manifest.name).toBe(result.value.spinnerName);
  });

  it.skipIf(!hasPablo)('two concurrent installs produce distinct op_ids', async () => {
    const dirA = await stageBundle();
    const dirB = await stageBundle();
    const pb = pbMock();
    const [a, b] = await Promise.all([
      installSpinnerBundle({
        bundlePath: dirA,
        actor: { kind: 'wizard', id: 'op-1' },
        fetch: pb.fetch,
        pbToken: 'tok',
        masterKey: TEST_MASTER_KEY,
        now: FIXED_NOW,
      }),
      installSpinnerBundle({
        bundlePath: dirB,
        actor: { kind: 'wizard', id: 'op-2' },
        fetch: pb.fetch,
        pbToken: 'tok',
        masterKey: TEST_MASTER_KEY,
        now: FIXED_NOW,
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.opId).not.toBe(b.value.opId);
  });
});

// Silence unused-imports complaints when this test file is built in
// isolation.
void rmdir;
