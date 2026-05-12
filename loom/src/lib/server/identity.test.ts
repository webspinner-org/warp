import { describe, it, expect } from 'vitest';
import {
  ensureCellIdentity,
  getCellIdentity,
  loadCellKeypair,
  signSpinnerDigest,
} from './identity.js';
import { encryptValue } from './crypto.js';
import {
  formatSpinnerDigest,
  verifyBundleDigest,
  type BundleDigestRecord,
} from '@webspinner-foundation/sdk';

// A 32-byte base64 master key for crypto.ts to use during tests.
const TEST_MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const FIXED_NOW = (): Date => new Date('2026-05-12T17:00:00.000Z');

function fixtureRecord(): BundleDigestRecord {
  return {
    schema: 'urn:webspinner:spinner-digest:v1.0.0',
    algorithm: 'sha256',
    digest: formatSpinnerDigest('sha256', 'a'.repeat(64)),
    computedAt: '2026-05-12T17:00:00.000Z',
    manifestCanonicalSha256: 'b'.repeat(64),
    missionLockSha256: 'c'.repeat(64),
    thumbnailSha256: 'd'.repeat(64),
    documentationSha256: [{ path: 'how-it-works.md', sha256: 'e'.repeat(64) }],
    entrypointSha256: 'f'.repeat(64),
  };
}

/**
 * A small in-memory PocketBase mock — captures POST writes, serves GET
 * reads from the captured state, returns 404 for missing rows. Speaks
 * just the slice of the PB REST API the identity module uses.
 */
function pbMock(): {
  fetch: typeof fetch;
  state: {
    identityCollection: boolean;
    identityRows: {
      id: string;
      public_key_hex: string;
      fingerprint: string;
      created_at: string;
    }[];
    vaultRows: { id: string; name: string; ciphertext: string; iv: string }[];
  };
} {
  const state = {
    identityCollection: false,
    identityRows: [] as {
      id: string;
      public_key_hex: string;
      fingerprint: string;
      created_at: string;
    }[],
    vaultRows: [] as { id: string; name: string; ciphertext: string; iv: string }[],
  };

  let nextId = 1;
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const notFound = () => new Response('{"code":404}', { status: 404 });

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    const search = new URL(url).search;

    if (path === '/api/collections/wp_cell_identity' && method === 'GET') {
      return state.identityCollection ? ok({ name: 'wp_cell_identity' }) : notFound();
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_cell_identity') {
        state.identityCollection = true;
        return ok({ name: body.name });
      }
      return ok({ name: body.name });
    }
    if (path === '/api/collections/wp_cell_identity/records' && method === 'GET') {
      const item = state.identityRows[0];
      return ok({ items: item ? [item] : [] });
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
      // Decode filter from search if present
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
    return notFound();
  }) as typeof fetch;

  return { fetch: fetchFn, state };
}

describe('Cell identity', () => {
  it('ensureCellIdentity generates a new keypair on first call', async () => {
    const pb = pbMock();
    const result = await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(true);
    expect(result.value.identity.publicKeyHex).toMatch(/^[a-f0-9]{64}$/);
    expect(result.value.identity.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(result.value.identity.createdAt).toBe('2026-05-12T17:00:00.000Z');
    expect(pb.state.identityRows).toHaveLength(1);
    expect(pb.state.vaultRows).toHaveLength(1);
    expect(pb.state.vaultRows[0]?.name).toBe('cell-identity-key');
  });

  it('ensureCellIdentity is idempotent: second call returns same identity, created=false', async () => {
    const pb = pbMock();
    const first = await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toBe(false);
    expect(second.value.identity.publicKeyHex).toBe(first.value.identity.publicKeyHex);
    expect(second.value.identity.fingerprint).toBe(first.value.identity.fingerprint);
    expect(pb.state.identityRows).toHaveLength(1);
    expect(pb.state.vaultRows).toHaveLength(1);
  });

  it('getCellIdentity returns null before provisioning, the row after', async () => {
    const pb = pbMock();
    expect(await getCellIdentity(pb.fetch, 'tok')).toBeNull();
    const ensure = await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    expect(ensure.ok).toBe(true);
    const id = await getCellIdentity(pb.fetch, 'tok');
    expect(id).not.toBeNull();
    if (ensure.ok && id) {
      expect(id.publicKeyHex).toBe(ensure.value.identity.publicKeyHex);
      expect(id.fingerprint).toBe(ensure.value.identity.fingerprint);
    }
  });

  it('loadCellKeypair recovers the same keypair after a round-trip', async () => {
    const pb = pbMock();
    const ensure = await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    expect(ensure.ok).toBe(true);
    if (!ensure.ok) return;
    const load = await loadCellKeypair(pb.fetch, 'tok', TEST_MASTER_KEY);
    expect(load.ok).toBe(true);
    if (!load.ok || !load.value) return;
    expect(load.value.publicKeyHex).toBe(ensure.value.identity.publicKeyHex);
    expect(load.value.fingerprint).toBe(ensure.value.identity.fingerprint);
    expect(load.value.privateKeyHex).toMatch(/^[a-f0-9]{64}$/);
  });

  it('loadCellKeypair returns ok:true value:null before provisioning', async () => {
    const pb = pbMock();
    const load = await loadCellKeypair(pb.fetch, 'tok', TEST_MASTER_KEY);
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.value).toBeNull();
  });

  it('loadCellKeypair reports corrupt-state when public key disagrees with vault private', async () => {
    const pb = pbMock();
    await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    // Tamper: replace the vault row with a different key.
    const bogus = await encryptValue(TEST_MASTER_KEY, '00'.repeat(32));
    if (pb.state.vaultRows[0]) {
      pb.state.vaultRows[0] = {
        ...pb.state.vaultRows[0],
        ciphertext: bogus.ciphertext,
        iv: bogus.iv,
      };
    }
    const load = await loadCellKeypair(pb.fetch, 'tok', TEST_MASTER_KEY);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.error.kind).toBe('corrupt-state');
  });

  it('loadCellKeypair reports corrupt-state when vault entry is missing', async () => {
    const pb = pbMock();
    await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    pb.state.vaultRows.length = 0;
    const load = await loadCellKeypair(pb.fetch, 'tok', TEST_MASTER_KEY);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.error.kind).toBe('corrupt-state');
  });

  it('signSpinnerDigest produces a verifiable signature', async () => {
    const pb = pbMock();
    const ensure = await ensureCellIdentity(pb.fetch, 'tok', TEST_MASTER_KEY, FIXED_NOW);
    expect(ensure.ok).toBe(true);
    if (!ensure.ok) return;
    const record = fixtureRecord();
    const signed = await signSpinnerDigest(pb.fetch, 'tok', TEST_MASTER_KEY, record, FIXED_NOW);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.value.signer).toBe(ensure.value.identity.fingerprint);
    const verified = verifyBundleDigest({
      digestRecord: record,
      signature: signed.value,
      publicKeyHex: ensure.value.identity.publicKeyHex,
    });
    expect(verified.ok).toBe(true);
  });
});
