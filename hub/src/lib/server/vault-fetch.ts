/**
 * Vault read-through for the hub. Fetches a secret by name from
 * the warp vault (PocketBase `vault_secrets` collection), decrypts
 * with `WARP_VAULT_MASTER_KEY`, returns plaintext.
 *
 * Required env vars:
 *   - WARP_PB_URL           — PocketBase URL (operator Loom's, port 8090)
 *   - WARP_PB_EMAIL         — superuser identity for that PB
 *   - WARP_PB_PASSWORD      — superuser password
 *   - WARP_VAULT_MASTER_KEY — AES-GCM key for value decryption
 *
 * Auth is per-call (no token caching for MVP). Auth failures and
 * lookup misses return `null` rather than throwing — the caller
 * decides whether the absence is fatal.
 */

import { decryptValue, type EncryptedValue } from './crypto.js';

interface PBVaultRecord {
  readonly name: string;
  readonly ciphertext: string;
  readonly iv: string;
}

interface PBSuperuserAuth {
  readonly token: string;
}

async function authSuperuser(fetchFn: typeof fetch, pbUrl: string): Promise<string | null> {
  const email = process.env['WARP_PB_EMAIL'];
  const password = process.env['WARP_PB_PASSWORD'];
  if (!email || !password) return null;
  try {
    const res = await fetchFn(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as PBSuperuserAuth;
    return body.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up a secret by name and return the decrypted plaintext.
 * Returns null on any failure (auth, lookup miss, decrypt error).
 */
export async function fetchVaultSecret(
  name: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) return null;
  const pbUrl = process.env['WARP_PB_URL'];
  if (!pbUrl) return null;

  const token = await authSuperuser(fetchFn, pbUrl);
  if (!token) return null;

  try {
    const url = `${pbUrl}/api/collections/vault_secrets/records?filter=${encodeURIComponent(
      `name = "${name}"`,
    )}&perPage=1`;
    const res = await fetchFn(url, { headers: { Authorization: token } });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: readonly PBVaultRecord[] };
    const row = body.items?.[0];
    if (!row) return null;
    const enc: EncryptedValue = { ciphertext: row.ciphertext, iv: row.iv };
    return await decryptValue(masterKey, enc);
  } catch {
    return null;
  }
}

/**
 * Resolve the Resend API key. Env-var first (operator override /
 * bootstrap), then vault. Returns null if neither path produces a
 * key — caller must surface that to the patron honestly rather
 * than emitting a misleading "code sent" toast.
 */
export async function resolveResendKey(fetchFn: typeof fetch = fetch): Promise<string | null> {
  const envKey = process.env['RESEND_API_KEY'];
  if (envKey && envKey.length > 0) return envKey;
  return await fetchVaultSecret('resend-api-key', fetchFn);
}
