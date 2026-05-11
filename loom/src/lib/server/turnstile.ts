// Cloudflare Turnstile — bot-defense token verification.
//
// Production mode: when both `turnstile-site-key` and `turnstile-secret-key`
// are in the vault, the registration form embeds the widget and the
// register action verifies the token against Cloudflare's siteverify
// endpoint. Failed verification rejects the registration.
//
// Bootstrap mode: when one or both are absent from the vault, the form
// skips the widget and the action skips verification. This is the path
// the Wizard uses for the founding registration — Turnstile credentials
// land in the vault after the first patron-facing registration is live.

import { loomPbToken } from './pocketbase.js';
import { decryptValue } from './crypto.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface PBVaultRecord {
  readonly id: string;
  readonly name: string;
  readonly ciphertext: string;
  readonly iv: string;
}

async function vaultLookup(
  fetchFn: typeof fetch,
  pbToken: string,
  masterKey: string,
  name: string,
): Promise<string | null> {
  try {
    const url = `${PB_URL}/api/collections/vault_secrets/records?filter=${encodeURIComponent(`name = "${name}"`)}&perPage=1`;
    const res = await fetchFn(url, { headers: { Authorization: pbToken } });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: readonly PBVaultRecord[] };
    const row = body.items?.[0];
    if (!row) return null;
    return await decryptValue(masterKey, { ciphertext: row.ciphertext, iv: row.iv });
  } catch {
    return null;
  }
}

export interface TurnstileCreds {
  readonly siteKey: string | null;
  readonly secretKey: string | null;
}

/**
 * Resolve site-key (public, ok to ship to the browser) and secret-key
 * (server-only, used for siteverify) from the vault. Returns nulls
 * when either is absent — caller treats that as bootstrap mode.
 */
export async function resolveTurnstileCreds(
  fetchFn: typeof fetch,
): Promise<TurnstileCreds> {
  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) return { siteKey: null, secretKey: null };
  const pbToken = await loomPbToken(fetchFn);
  if (!pbToken) return { siteKey: null, secretKey: null };
  const [siteKey, secretKey] = await Promise.all([
    vaultLookup(fetchFn, pbToken, masterKey, 'turnstile-site-key'),
    vaultLookup(fetchFn, pbToken, masterKey, 'turnstile-secret-key'),
  ]);
  return { siteKey, secretKey };
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly mode: 'verified' | 'bootstrap-skipped' | 'rejected' | 'error';
  readonly errorCodes?: readonly string[];
  readonly note?: string;
}

/**
 * Verify a Turnstile token against Cloudflare's siteverify.
 *
 * If `secretKey` is null, returns `mode: 'bootstrap-skipped'` with `ok: true` —
 * the Cell is in bootstrap mode (no Turnstile vaulted yet) and the
 * registration flow falls back to honeypot + rate-limit defense only.
 */
export async function verifyTurnstileToken(
  fetchFn: typeof fetch,
  args: { readonly token: string | null; readonly secretKey: string | null; readonly remoteIp?: string },
): Promise<VerifyResult> {
  if (!args.secretKey) {
    return { ok: true, mode: 'bootstrap-skipped', note: 'Turnstile secret not vaulted; bootstrap defense only.' };
  }
  if (!args.token || args.token.length === 0) {
    return {
      ok: false,
      mode: 'rejected',
      note: 'Turnstile token missing — the widget did not complete or was bypassed.',
    };
  }
  const form = new URLSearchParams();
  form.set('secret', args.secretKey);
  form.set('response', args.token);
  if (args.remoteIp) form.set('remoteip', args.remoteIp);

  let res: Response;
  try {
    res = await fetchFn(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch (e) {
    return {
      ok: false,
      mode: 'error',
      note: `Turnstile siteverify unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let body: { success?: unknown; 'error-codes'?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    return { ok: false, mode: 'error', note: `siteverify returned non-JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  const success = body.success === true;
  const errorCodes = Array.isArray(body['error-codes'])
    ? (body['error-codes'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];

  if (success) {
    return { ok: true, mode: 'verified' };
  }
  return {
    ok: false,
    mode: 'rejected',
    errorCodes,
    note: `siteverify rejected: ${errorCodes.join(', ') || 'no error codes'}.`,
  };
}
