/**
 * Orchestration tests for `verifySpinnerBundle`. Uses an on-disk tmpdir
 * copy of Pablo so we exercise the full happy path (sign, then verify)
 * plus the failure modes (unsigned, digest-mismatch, signature-invalid).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, cp, stat, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { signSpinnerBundle } from './spinner-sign-op.js';
import { verifySpinnerBundle } from './spinner-verify-op.js';

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
  const dir = await mkdtemp(join(root, '.test-verify-op-'));
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
}

function pbMock(): { fetch: typeof fetch; state: PbState } {
  const state: PbState = {
    identityCollection: false,
    identityRows: [],
    vaultRows: [],
    operationsCollection: false,
    operationsRows: [],
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
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_cell_identity') state.identityCollection = true;
      if (body.name === 'wp_operations') state.operationsCollection = true;
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
    return notFound();
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

describe('verifySpinnerBundle', async () => {
  const hasPablo = await pabloExists();

  it.skipIf(!hasPablo)('unsigned bundle reports unsigned: true, status: partial', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const result = await verifySpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unsigned).toBe(true);
    expect(result.value.allValid).toBe(false);
    expect(pb.state.operationsRows[0]?.['status']).toBe('partial');
  });

  it.skipIf(!hasPablo)('signed bundle verifies all signers as valid (status: ok)', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const signed = await signSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(signed.ok).toBe(true);

    const result = await verifySpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unsigned).toBe(false);
    expect(result.value.digestMatches).toBe(true);
    expect(result.value.allValid).toBe(true);
    expect(result.value.signers).toHaveLength(1);
    expect(result.value.signers[0]?.valid).toBe(true);
    // operations rows: one sign + one verify (the verify is partial→ok)
    expect(pb.state.operationsRows.at(-1)?.['kind']).toBe('spinner.verify');
    expect(pb.state.operationsRows.at(-1)?.['status']).toBe('ok');
  });

  it.skipIf(!hasPablo)('digest-mismatch when a non-digest file changes after signing', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    await signSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });

    // Mutate mission-lock.md (an integrity-tracked file). The recomputed
    // digest will differ from the recorded one.
    const missionLockPath = join(dir, 'mission-lock.md');
    const original = await readFile(missionLockPath, 'utf8');
    await writeFile(missionLockPath, original + '\n# Tampered\n', 'utf8');

    const result = await verifySpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.digestMatches).toBe(false);
    expect(result.value.allValid).toBe(false);
    expect(result.value.recordedDigest).toBeDefined();
    expect(result.value.observedDigest).not.toBe(result.value.recordedDigest);
    // status: partial because the op completed but the verification failed
    expect(pb.state.operationsRows.at(-1)?.['status']).toBe('partial');
  });

  it.skipIf(!hasPablo)('signature-invalid when a .sig is tampered (digest unchanged)', async () => {
    const dir = await stageBundle();
    const pb = pbMock();
    const signed = await signSpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      masterKey: TEST_MASTER_KEY,
      now: FIXED_NOW,
    });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const hex = signed.value.digest.split(':')[1] ?? '';
    const sigPath = join(dir, 'provenance', `${hex}.${signed.value.signerFingerprint}.sig`);
    const original = await readFile(sigPath, 'utf8');
    const ch = original[12] ?? 'a';
    const flipped = original.slice(0, 12) + (ch === 'b' ? 'c' : 'b') + original.slice(13);
    await writeFile(sigPath, flipped, 'utf8');

    const result = await verifySpinnerBundle({
      bundlePath: dir,
      actor: { kind: 'wizard', id: 'test-wiz' },
      fetch: pb.fetch,
      pbToken: 'tok',
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.digestMatches).toBe(true);
    expect(result.value.allValid).toBe(false);
    expect(result.value.signers[0]?.valid).toBe(false);
    expect(result.value.signers[0]?.reason).toBe('signature-invalid');
  });

  it('path outside the allowed sandboxes is rejected', async () => {
    const pb = pbMock();
    const result = await verifySpinnerBundle({
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
  });
});
