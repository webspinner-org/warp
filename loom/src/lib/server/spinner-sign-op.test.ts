/**
 * Orchestration tests for `signSpinnerBundle`. Use an on-disk tmpdir
 * copy of Pablo + an in-memory PocketBase mock so we exercise the
 * full flow (path validation, digest, identity, sign, provenance,
 * operations log) without depending on a live PB instance.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, cp, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { signSpinnerBundle } from './spinner-sign-op.js';

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

const PABLO_DIR = resolve(process.env['HOME'] ?? '~', 'warp/spinners/pablo');

async function pabloExists(): Promise<boolean> {
  try {
    const s = await stat(PABLO_DIR);
    return s.isDirectory();
  } catch {
    return false;
  }
}

const TEST_MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const FIXED_NOW = (): Date => new Date('2026-05-12T17:00:00.000Z');

async function stageBundle(): Promise<string> {
  // mkdtemp under the warp/spinners directory so the path-allowlist
  // check accepts it. Pablo's manifest is read as-is; the digest +
  // signature are written into the staged copy. The afterEach hook
  // cleans these up so we don't leak directories.
  const root = resolve(process.env['HOME'] ?? '~', 'warp/spinners');
  const dir = await mkdtemp(join(root, '.test-sign-op-'));
  stagedDirs.push(dir);
  await cp(PABLO_DIR, dir, { recursive: true });
  return dir;
}

interface PbState {
  identityCollection: boolean;
  identityRows: {
    id: string;
    public_key_hex: string;
    fingerprint: string;
    created_at: string;
  }[];
  vaultRows: { id: string; name: string; ciphertext: string; iv: string }[];
  operationsCollection: boolean;
  operationsRows: Record<string, unknown>[];
  auditCollection: boolean;
  auditRows: Record<string, unknown>[];
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

describe('signSpinnerBundle', async () => {
  const hasPablo = await pabloExists();

  it.skipIf(!hasPablo)('happy path: signs Pablo, writes provenance, logs op row', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const result = await signSpinnerBundle({
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
    expect(result.value.signerFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(result.value.identityCreated).toBe(true);
    expect(result.value.filesWritten).toHaveLength(3);
    expect(result.value.opId).toMatch(/^[0-9a-f-]{36}$/);

    // Provenance files actually on disk.
    const provDir = join(dir, 'provenance');
    expect((await stat(provDir)).isDirectory()).toBe(true);
    expect((await stat(join(provDir, 'signers.json'))).isFile()).toBe(true);

    // wp_operations row captured.
    expect(pb.state.operationsRows).toHaveLength(1);
    const row = pb.state.operationsRows[0]!;
    expect(row['kind']).toBe('spinner.sign');
    expect(row['status']).toBe('ok');
    expect(row['actor_kind']).toBe('wizard');

    // wp_audit row captured, correlated to op.
    expect(pb.state.auditRows).toHaveLength(1);
    const audit = pb.state.auditRows[0]!;
    expect(audit['event_type']).toBe('wp.spinner.signed');
    expect(audit['audit_result']).toBe('success');
    expect(audit['correlation_id']).toBe(row['op_id']);
    expect(audit['event_subject']).toBe('@webspinner-foundation/pablo');
    expect(audit['actor_kind']).toBe('human');
    expect(audit['ocsf_class']).toBe(6003);
    const data = audit['data'] as Record<string, unknown>;
    expect(data['digest']).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(data['signerFingerprint']).toMatch(/^[a-f0-9]{16}$/);
    expect(data['signerLabel']).toBe('cell-identity-key');
    expect(data['identityCreated']).toBe(true);
    expect(audit['event_source']).toBe(`urn:webspinner:cell:${result.value.signerFingerprint}`);
  });

  it.skipIf(!hasPablo)(
    'idempotent: second sign with same identity is still ok + logs another op row',
    async () => {
      const dir = await stageBundle();
      const pb = pbMock();
      const first = await signSpinnerBundle({
        bundlePath: dir,
        actor: { kind: 'wizard', id: 'test-wiz' },
        fetch: pb.fetch,
        pbToken: 'tok',
        masterKey: TEST_MASTER_KEY,
        now: FIXED_NOW,
      });
      expect(first.ok).toBe(true);

      const second = await signSpinnerBundle({
        bundlePath: dir,
        actor: { kind: 'wizard', id: 'test-wiz' },
        fetch: pb.fetch,
        pbToken: 'tok',
        masterKey: TEST_MASTER_KEY,
        now: FIXED_NOW,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.identityCreated).toBe(false);
      expect(pb.state.operationsRows).toHaveLength(2);
    },
  );

  it('rejects path outside the allowed sandboxes', async () => {
    const pb = pbMock();
    const result = await signSpinnerBundle({
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
    // Still logs an op row so the attempted access is recorded.
    expect(pb.state.operationsRows).toHaveLength(1);
    expect(pb.state.operationsRows[0]?.['status']).toBe('failed');
    // Audit: denied (refused by sandbox policy).
    expect(pb.state.auditRows).toHaveLength(1);
    expect(pb.state.auditRows[0]?.['event_type']).toBe('wp.spinner.signed');
    expect(pb.state.auditRows[0]?.['audit_result']).toBe('denied');
    const data = pb.state.auditRows[0]?.['data'] as Record<string, unknown>;
    expect(data['errorKind']).toBe('path-not-allowed');
    expect(data['bundlePath']).toBe('/etc/passwd');
  });

  it.skipIf(!hasPablo)('rejects bundle-not-found inside the allowed sandbox', async () => {
    const pb = pbMock();
    const fakeDir = resolve(process.env['HOME'] ?? '~', 'warp/spinners/this-does-not-exist-12345');
    const result = await signSpinnerBundle({
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

  it.skipIf(!hasPablo)('captures structured error in the operations row on failure', async () => {
    const pb = pbMock();
    const result = await signSpinnerBundle({
      bundlePath: '/tmp/not-allowed',
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    const row = pb.state.operationsRows[0]!;
    expect(row['error_kind']).toBe('path-not-allowed');
    expect(row['error_message']).toContain('path-not-allowed');
  });
});
