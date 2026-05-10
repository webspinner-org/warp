import { encryptValue, type EncryptedValue } from './crypto.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'vault_secrets';

export interface SecretRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly created: string;
  readonly updated: string;
}

interface PBListResponse {
  readonly items: readonly (SecretRow & EncryptedValue)[];
}

export type SecretError =
  | { readonly kind: 'duplicate-name' }
  | { readonly kind: 'invalid-name' }
  | { readonly kind: 'auth' }
  | { readonly kind: 'backend'; readonly status: number; readonly body: string };

export type SecretResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SecretError };

const NAME_RE = /^[a-zA-Z0-9_./-]{1,64}$/;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

/**
 * Idempotently create the vault_secrets collection on PocketBase. Safe to call
 * on every load — checks for existence first; only POSTs the schema if absent.
 */
export async function ensureCollection(
  fetchFn: typeof fetch,
  token: string,
): Promise<SecretResult<void>> {
  const head = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}`, {
    headers: authHeaders(token),
  });
  if (head.ok) return { ok: true, value: undefined };
  if (head.status !== 404) {
    return { ok: false, error: { kind: 'backend', status: head.status, body: await head.text() } };
  }

  const create = await fetchFn(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'name', type: 'text', required: true, presentable: true, unique: true, max: 64 },
        { name: 'ciphertext', type: 'text', required: true, max: 4096 },
        { name: 'iv', type: 'text', required: true, max: 32 },
        { name: 'description', type: 'text', required: false, max: 256 },
        // Auto-managed timestamps. PB v0.30+ requires these to be declared
        // explicitly as `autodate` system fields on base collections.
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [`CREATE UNIQUE INDEX idx_${COLLECTION}_name ON ${COLLECTION} (name)`],
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

export async function listSecrets(
  fetchFn: typeof fetch,
  token: string,
): Promise<SecretResult<SecretRow[]>> {
  const res = await fetchFn(
    `${PB_URL}/api/collections/${COLLECTION}/records?perPage=200&sort=name`,
    { headers: authHeaders(token) },
  );
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: { kind: 'auth' } };
  }
  if (!res.ok) {
    return { ok: false, error: { kind: 'backend', status: res.status, body: await res.text() } };
  }
  const body = (await res.json()) as PBListResponse;
  const rows = body.items.map<SecretRow>((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    created: r.created,
    updated: r.updated,
  }));
  return { ok: true, value: rows };
}

export async function addSecret(
  fetchFn: typeof fetch,
  token: string,
  masterKey: string,
  name: string,
  value: string,
  description: string,
): Promise<SecretResult<SecretRow>> {
  if (!NAME_RE.test(name)) return { ok: false, error: { kind: 'invalid-name' } };

  const enc = await encryptValue(masterKey, value);
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name, description, ciphertext: enc.ciphertext, iv: enc.iv }),
  });
  if (res.status === 400) {
    const body = (await res.json()) as { data?: Record<string, { code?: string }> };
    if (body.data?.['name']?.code === 'validation_not_unique') {
      return { ok: false, error: { kind: 'duplicate-name' } };
    }
    return {
      ok: false,
      error: { kind: 'backend', status: 400, body: JSON.stringify(body) },
    };
  }
  if (!res.ok) {
    return { ok: false, error: { kind: 'backend', status: res.status, body: await res.text() } };
  }
  const row = (await res.json()) as SecretRow;
  return { ok: true, value: row };
}

export async function deleteSecret(
  fetchFn: typeof fetch,
  token: string,
  id: string,
): Promise<SecretResult<void>> {
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: { kind: 'auth' } };
  }
  if (!res.ok && res.status !== 404) {
    return { ok: false, error: { kind: 'backend', status: res.status, body: await res.text() } };
  }
  return { ok: true, value: undefined };
}
