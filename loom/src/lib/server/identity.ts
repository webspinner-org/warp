/**
 * Cell identity — the operator's ed25519 keypair that signs Spinner bundle
 * digests and (eventually) authenticates Cell-to-Cell calls on the
 * Capability Bus.
 *
 * Storage model:
 *   - Private key: vault entry `cell-identity-key`, AES-GCM-256 encrypted
 *     by the existing crypto.ts using `WARP_VAULT_MASTER_KEY`.
 *   - Public key + fingerprint: PocketBase collection `wp_cell_identity`,
 *     a single-row collection (the canonical "this Cell's identity").
 *     Authenticated read; no decryption needed to surface.
 *
 * The bootstrap is idempotent — `ensureCellIdentity` generates a fresh
 * keypair only when none is present. A second call returns the existing
 * identity. This matches the contract every other bootstrap surface in
 * the Loom follows.
 *
 * The signing helper `signSpinnerDigest` is a thin convenience over the
 * SDK's `signBundleDigest` — it loads the keypair, signs the supplied
 * record, returns the SpinnerSignature. The caller decides where the
 * signature gets persisted (provenance file, audit event, both).
 */

import { encryptValue, decryptValue, type EncryptedValue } from './crypto.js';
import { ensureCollection as ensureVaultCollection } from './secrets.js';
import {
  generateKeypair,
  keypairFromPrivateHex,
  signBundleDigest,
  type Ed25519Keypair,
  type BundleDigestRecord,
  type SpinnerSignature,
} from '@webspinner-foundation/sdk';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const IDENTITY_COLLECTION = 'wp_cell_identity';
const VAULT_NAME = 'cell-identity-key';
const VAULT_COLLECTION = 'vault_secrets';

export interface CellIdentityPublic {
  /** ed25519 public key, lowercase hex (64 chars). */
  readonly publicKeyHex: string;
  /** First 16 hex chars of sha256(publicKey). */
  readonly fingerprint: string;
  /** RFC 3339 timestamp the keypair was first generated. */
  readonly createdAt: string;
}

export type IdentityError =
  | { readonly kind: 'auth' }
  | { readonly kind: 'no-master-key' }
  | { readonly kind: 'backend'; readonly status: number; readonly body: string }
  | { readonly kind: 'corrupt-state'; readonly detail: string };

export type IdentityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IdentityError };

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

interface PBIdentityRow {
  readonly id: string;
  readonly public_key_hex: string;
  readonly fingerprint: string;
  readonly created_at: string;
}

interface PBVaultRow {
  readonly id: string;
  readonly name: string;
  readonly ciphertext: string;
  readonly iv: string;
}

/**
 * Idempotently create the `wp_cell_identity` collection. Safe to call on
 * every load — checks for existence first, only POSTs the schema if absent.
 */
export async function ensureIdentityCollection(
  fetchFn: typeof fetch,
  token: string,
): Promise<IdentityResult<void>> {
  const head = await fetchFn(`${PB_URL}/api/collections/${IDENTITY_COLLECTION}`, {
    headers: authHeaders(token),
  });
  if (head.ok) return { ok: true, value: undefined };
  if (head.status === 401 || head.status === 403) return { ok: false, error: { kind: 'auth' } };
  if (head.status !== 404) {
    return {
      ok: false,
      error: { kind: 'backend', status: head.status, body: await head.text() },
    };
  }
  const create = await fetchFn(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: IDENTITY_COLLECTION,
      type: 'base',
      fields: [
        { name: 'public_key_hex', type: 'text', required: true, max: 128, presentable: true },
        { name: 'fingerprint', type: 'text', required: true, max: 32, presentable: true },
        { name: 'created_at', type: 'text', required: true, max: 32 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${IDENTITY_COLLECTION}_fp ON ${IDENTITY_COLLECTION} (fingerprint)`,
      ],
    }),
  });
  if (!create.ok) {
    return {
      ok: false,
      error: { kind: 'backend', status: create.status, body: await create.text() },
    };
  }
  return { ok: true, value: undefined };
}

async function findVaultRow(
  fetchFn: typeof fetch,
  token: string,
  name: string,
): Promise<PBVaultRow | null> {
  const url = `${PB_URL}/api/collections/${VAULT_COLLECTION}/records?filter=${encodeURIComponent(`name = "${name}"`)}&perPage=1`;
  const res = await fetchFn(url, { headers: { Authorization: token } });
  if (!res.ok) return null;
  const body = (await res.json()) as { items?: readonly PBVaultRow[] };
  return body.items?.[0] ?? null;
}

async function readIdentityRow(
  fetchFn: typeof fetch,
  token: string,
): Promise<PBIdentityRow | null> {
  const url = `${PB_URL}/api/collections/${IDENTITY_COLLECTION}/records?perPage=1`;
  const res = await fetchFn(url, { headers: { Authorization: token } });
  if (!res.ok) return null;
  const body = (await res.json()) as { items?: readonly PBIdentityRow[] };
  return body.items?.[0] ?? null;
}

async function writeIdentityRow(
  fetchFn: typeof fetch,
  token: string,
  publicKeyHex: string,
  fingerprint: string,
  createdAt: string,
): Promise<IdentityResult<void>> {
  const res = await fetchFn(`${PB_URL}/api/collections/${IDENTITY_COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      public_key_hex: publicKeyHex,
      fingerprint,
      created_at: createdAt,
    }),
  });
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: 'backend', status: res.status, body: await res.text() },
    };
  }
  return { ok: true, value: undefined };
}

async function writeVaultRow(
  fetchFn: typeof fetch,
  token: string,
  masterKey: string,
  name: string,
  value: string,
  description: string,
): Promise<IdentityResult<void>> {
  const enc: EncryptedValue = await encryptValue(masterKey, value);
  const res = await fetchFn(`${PB_URL}/api/collections/${VAULT_COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name,
      description,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
    }),
  });
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: 'backend', status: res.status, body: await res.text() },
    };
  }
  return { ok: true, value: undefined };
}

/**
 * Read this Cell's public identity. Returns null if no identity has been
 * provisioned yet — `ensureCellIdentity` provisions on first call.
 */
export async function getCellIdentity(
  fetchFn: typeof fetch,
  token: string,
): Promise<CellIdentityPublic | null> {
  const row = await readIdentityRow(fetchFn, token);
  if (!row) return null;
  return {
    publicKeyHex: row.public_key_hex,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
  };
}

/**
 * Provision this Cell's identity keypair if not present. Idempotent: a
 * second call returns the existing identity with `created: false`.
 *
 * Generates a fresh ed25519 keypair, stores the private half in the vault,
 * stores the public half + fingerprint + creation timestamp in the
 * `wp_cell_identity` collection. Both writes must succeed for the
 * identity to be considered provisioned.
 */
export async function ensureCellIdentity(
  fetchFn: typeof fetch,
  token: string,
  masterKey: string,
  now: () => Date = () => new Date(),
): Promise<IdentityResult<{ readonly identity: CellIdentityPublic; readonly created: boolean }>> {
  const ensure = await ensureIdentityCollection(fetchFn, token);
  if (!ensure.ok) return ensure;

  // Ensure the vault collection exists before any write to it. On the
  // operator's Cell this collection was bootstrapped by Genesis's
  // `seedVault` step before identity provisioning; on a fresh Cell
  // (e.g. the Demo Cell), no prior step has created it, and the first
  // `writeVaultRow` below would 404 with "Missing or invalid collection
  // context." Idempotent: returns `{ ok: true }` if already present.
  const vaultEnsure = await ensureVaultCollection(fetchFn, token);
  if (!vaultEnsure.ok) {
    // SecretError narrows to either 'auth' or 'backend' on ensure;
    // 'duplicate-name' and 'invalid-name' aren't produced by the
    // collection-ensure path. Either shape maps cleanly into our
    // IdentityError union.
    const e = vaultEnsure.error;
    if (e.kind === 'auth') return { ok: false, error: { kind: 'auth' } };
    if (e.kind === 'backend') {
      return { ok: false, error: { kind: 'backend', status: e.status, body: e.body } };
    }
    // 'duplicate-name' / 'invalid-name' aren't produced by ensure-collection,
    // but the union forces us to handle them. Map to corrupt-state.
    return {
      ok: false,
      error: { kind: 'corrupt-state', detail: `vault ensure returned ${e.kind}` },
    };
  }

  const existing = await readIdentityRow(fetchFn, token);
  if (existing) {
    const vaultRow = await findVaultRow(fetchFn, token, VAULT_NAME);
    if (!vaultRow) {
      return {
        ok: false,
        error: {
          kind: 'corrupt-state',
          detail:
            'wp_cell_identity row exists but vault entry `cell-identity-key` is missing. Manual recovery required.',
        },
      };
    }
    return {
      ok: true,
      value: {
        identity: {
          publicKeyHex: existing.public_key_hex,
          fingerprint: existing.fingerprint,
          createdAt: existing.created_at,
        },
        created: false,
      },
    };
  }

  const kp = generateKeypair();
  const createdAt = now().toISOString();

  const vaultWrite = await writeVaultRow(
    fetchFn,
    token,
    masterKey,
    VAULT_NAME,
    kp.privateKeyHex,
    'Cell identity — ed25519 private key. Signs Spinner bundle digests and Cell-to-Cell calls. Never log; never export; never paste.',
  );
  if (!vaultWrite.ok) return vaultWrite;

  const identityWrite = await writeIdentityRow(
    fetchFn,
    token,
    kp.publicKeyHex,
    kp.fingerprint,
    createdAt,
  );
  if (!identityWrite.ok) return identityWrite;

  return {
    ok: true,
    value: {
      identity: {
        publicKeyHex: kp.publicKeyHex,
        fingerprint: kp.fingerprint,
        createdAt,
      },
      created: true,
    },
  };
}

/**
 * Load the Cell's full keypair (private + public + fingerprint). Reads the
 * vault, decrypts the private key, verifies it derives to the recorded
 * public key. Returns null if no identity is provisioned.
 *
 * The private key is held in memory only for the lifetime of the
 * returned object. Callers should drop the reference promptly after use.
 */
export async function loadCellKeypair(
  fetchFn: typeof fetch,
  token: string,
  masterKey: string,
): Promise<IdentityResult<Ed25519Keypair | null>> {
  const identity = await getCellIdentity(fetchFn, token);
  if (!identity) return { ok: true, value: null };

  const vaultRow = await findVaultRow(fetchFn, token, VAULT_NAME);
  if (!vaultRow) {
    return {
      ok: false,
      error: {
        kind: 'corrupt-state',
        detail:
          'wp_cell_identity row exists but vault entry `cell-identity-key` is missing. Manual recovery required.',
      },
    };
  }

  const privateKeyHex = await decryptValue(masterKey, {
    ciphertext: vaultRow.ciphertext,
    iv: vaultRow.iv,
  });
  const kp = keypairFromPrivateHex(privateKeyHex);
  if (kp.publicKeyHex !== identity.publicKeyHex) {
    return {
      ok: false,
      error: {
        kind: 'corrupt-state',
        detail: `Recorded public key (${identity.fingerprint}) does not match the key derived from the vault private. The vault and the identity row are out of sync.`,
      },
    };
  }
  return { ok: true, value: kp };
}

/**
 * Sign a Spinner bundle digest record with the Cell's identity key.
 * Returns a SpinnerSignature ready for persistence in
 * `provenance/<digest>.sig` + `provenance/signers.json`.
 */
export async function signSpinnerDigest(
  fetchFn: typeof fetch,
  token: string,
  masterKey: string,
  digestRecord: BundleDigestRecord,
  now: () => Date = () => new Date(),
): Promise<IdentityResult<SpinnerSignature>> {
  const load = await loadCellKeypair(fetchFn, token, masterKey);
  if (!load.ok) return load;
  if (!load.value) {
    return {
      ok: false,
      error: {
        kind: 'corrupt-state',
        detail: 'No Cell identity is provisioned. Call ensureCellIdentity first.',
      },
    };
  }
  const sig = signBundleDigest({
    digestRecord,
    privateKeyHex: load.value.privateKeyHex,
    publicKeyHex: load.value.publicKeyHex,
    signer: 'cell-identity-key',
    now,
  });
  return { ok: true, value: sig };
}
