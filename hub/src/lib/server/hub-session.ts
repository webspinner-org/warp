/**
 * Hub session cookie — HMAC-signed, stateless. No PocketBase / DB
 * involvement; verification is local CPU only.
 *
 * Format: base64url("<sub>|<email>|<name>|<picture>|<expiryMs>|<sig>")
 *   where sig = HMAC-SHA256(masterKey, "<sub>|<email>|<name>|<picture>|<expiryMs>")
 *
 * Reuses WARP_VAULT_MASTER_KEY per Wizard's authorization. The
 * cookie itself is the only auth proof the hub has on a request;
 * the patron's Google session is not re-checked on every request.
 * 7-day TTL.
 */

import { createHmac } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'warp_hub';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface HubSession {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly picture: string;
  readonly expiry: number;
}

function masterKey(): string {
  const k = process.env['WARP_VAULT_MASTER_KEY'];
  if (!k) throw new Error('WARP_VAULT_MASTER_KEY not set');
  return k;
}

function encodeField(s: string): string {
  return encodeURIComponent(s);
}
function decodeField(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function mintHubCookie(input: {
  sub: string;
  email: string;
  name: string;
  picture: string;
}): { value: string; maxAge: number } {
  const expiry = Date.now() + TTL_MS;
  const payload = [
    encodeField(input.sub),
    encodeField(input.email.trim().toLowerCase()),
    encodeField(input.name),
    encodeField(input.picture),
    String(expiry),
  ].join('|');
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
  if (parts.length !== 6) return null;
  const [sub, email, name, picture, expiryStr, sig] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const expected = createHmac('sha256', masterKey())
    .update(`${sub}|${email}|${name}|${picture}|${expiry}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return null;
  return {
    sub: decodeField(sub),
    email: decodeField(email),
    name: decodeField(name),
    picture: decodeField(picture),
    expiry,
  };
}

export function setHubCookie(
  cookies: Cookies,
  input: { sub: string; email: string; name: string; picture: string },
): void {
  const minted = mintHubCookie(input);
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

/**
 * Short-lived (10 min) signed cookie used to carry OAuth `state`
 * across the redirect to Google and back. Stops CSRF on the
 * callback.
 */
const STATE_COOKIE = 'warp_hub_oauth_state';
const STATE_TTL_S = 600;

export function setOAuthStateCookie(cookies: Cookies, state: string): void {
  cookies.set(STATE_COOKIE, state, {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: STATE_TTL_S,
  });
}
export function readOAuthStateCookie(cookies: Cookies): string | null {
  return cookies.get(STATE_COOKIE) ?? null;
}
export function clearOAuthStateCookie(cookies: Cookies): void {
  cookies.set(STATE_COOKIE, '', { path: '/auth', maxAge: 0 });
}

export const HUB_COOKIE_NAME = COOKIE_NAME;
