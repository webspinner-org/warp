/**
 * Hub session cookie — HMAC-signed, stateless. No DB.
 *
 * Format: base64url("<email>|<expiryMs>|<sig>")
 *   sig = HMAC-SHA256(masterKey, "<email>|<expiryMs>").slice(0,32)
 *
 * Wizard status is derived from the email at request time (via
 * isWizard()), so the cookie itself never goes stale on allowlist
 * changes. 7-day TTL.
 */

import { createHmac } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'warp_hub';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface HubSession {
  readonly email: string;
  readonly expiry: number;
}

function masterKey(): string {
  const k = process.env['WARP_VAULT_MASTER_KEY'];
  if (!k) throw new Error('WARP_VAULT_MASTER_KEY not set');
  return k;
}

export function mintHubCookie(email: string): { value: string; maxAge: number } {
  const normalized = email.trim().toLowerCase();
  const expiry = Date.now() + TTL_MS;
  const payload = `${normalized}|${expiry}`;
  const sig = createHmac('sha256', masterKey()).update(payload).digest('hex').slice(0, 32);
  const value = Buffer.from(`${payload}|${sig}`).toString('base64url');
  return { value, maxAge: Math.floor(TTL_MS / 1000) };
}

export function verifyHubCookie(raw: string | undefined): HubSession | null {
  if (!raw) return null;
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
  const expected = createHmac('sha256', masterKey())
    .update(`${email}|${expiry}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return null;
  return { email, expiry };
}

export function setHubCookie(cookies: Cookies, email: string): void {
  const minted = mintHubCookie(email);
  cookies.set(COOKIE_NAME, minted.value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: minted.maxAge,
  });
}

export function clearHubCookie(cookies: Cookies): void {
  cookies.set(COOKIE_NAME, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 0,
  });
}

export function getHubSession(cookies: Cookies): HubSession | null {
  return verifyHubCookie(cookies.get(COOKIE_NAME));
}

export const HUB_COOKIE_NAME = COOKIE_NAME;
