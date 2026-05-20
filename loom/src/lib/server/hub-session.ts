/**
 * Hub session verification — for services that trust the warp_hub
 * cookie as SSO identity (the demo Loom's /api/owned, future
 * cross-surface auth checks).
 *
 * The cookie is minted by the hub (hub/src/lib/server/hub-session.ts)
 * with payload `email|expiryMs|sig`. Sig = HMAC-SHA256(masterKey,
 * `email|expiryMs`).slice(0,32). To verify here, this service must
 * be configured with the same master key the hub uses for minting —
 * use WARP_HUB_COOKIE_KEY env (fall through to WARP_VAULT_MASTER_KEY
 * when running co-located with the hub). 7-day TTL.
 */

import { createHmac } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'warp_hub';

export interface HubSession {
  readonly email: string;
  readonly expiry: number;
}

function key(): string | null {
  return process.env['WARP_HUB_COOKIE_KEY'] ?? process.env['WARP_VAULT_MASTER_KEY'] ?? null;
}

export function verifyHubCookie(raw: string | undefined): HubSession | null {
  if (!raw) return null;
  const k = key();
  if (!k) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split('|');
  if (parts.length !== 3) return null;
  const [email, expiryStr, sig] = parts as [string, string, string];
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const expected = createHmac('sha256', k).update(`${email}|${expiry}`).digest('hex').slice(0, 32);
  if (sig !== expected) return null;
  return { email, expiry };
}

export function getHubSession(cookies: Cookies): HubSession | null {
  return verifyHubCookie(cookies.get(COOKIE_NAME));
}

export const HUB_COOKIE_NAME = COOKIE_NAME;
