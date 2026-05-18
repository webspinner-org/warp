/**
 * Author session — short HMAC-signed cookie that proves the bearer
 * has verified a particular email address through the 6-digit-code
 * flow. Used by the app.webspinner.ai dashboard at /me to list the
 * author's published Webbases.
 *
 * Distinct from the Loom admin session: the author surface is a
 * patron-facing surface; the dashboard's authority is "the email
 * matches the verified address on a row in wp_app_packages." No
 * PocketBase superuser involved.
 *
 * Cookie format:
 *     warp_author=<base64url(email|expiry|sig)>
 *   where sig = HMAC-SHA256(masterKey, email|expiry).slice(0,32)
 *
 * 7-day TTL. The cookie is opaque to the browser; the Loom decodes
 * + verifies + extracts email on each request.
 */

import { createHmac } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'warp_author';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthorSession {
  readonly email: string;
  readonly expiry: number;
}

export function mintAuthorCookie(
  email: string,
  masterKey: string,
): {
  value: string;
  maxAge: number;
} {
  const normalized = email.trim().toLowerCase();
  const expiry = Date.now() + TTL_MS;
  const payload = `${normalized}|${expiry}`;
  const sig = createHmac('sha256', masterKey).update(payload).digest('hex').slice(0, 32);
  const value = Buffer.from(`${payload}|${sig}`).toString('base64url');
  return { value, maxAge: Math.floor(TTL_MS / 1000) };
}

export function verifyAuthorCookie(
  raw: string | undefined,
  masterKey: string,
): AuthorSession | null {
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
  const expected = createHmac('sha256', masterKey)
    .update(`${email}|${expiry}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return null;
  return { email, expiry };
}

export function setAuthorCookie(cookies: Cookies, email: string, masterKey: string): void {
  const minted = mintAuthorCookie(email, masterKey);
  cookies.set(COOKIE_NAME, minted.value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: minted.maxAge,
  });
}

export function clearAuthorCookie(cookies: Cookies): void {
  cookies.set(COOKIE_NAME, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 0,
  });
}

export function getAuthorSession(cookies: Cookies, masterKey: string): AuthorSession | null {
  return verifyAuthorCookie(cookies.get(COOKIE_NAME), masterKey);
}

export const AUTHOR_COOKIE_NAME = COOKIE_NAME;
