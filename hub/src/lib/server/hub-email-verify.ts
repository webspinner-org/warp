/**
 * Email verification — 6-digit code, 10-minute TTL. Stateless:
 * the pending verification rides in a short-lived signed cookie
 * (warp_hub_pending) carried from /auth/email/start to
 * /auth/email/finish. No PocketBase, no in-memory store.
 *
 * Pending cookie shape: base64url("<email>|<expiryMs>|<codeHmac>|<sig>")
 *   codeHmac = HMAC(masterKey, "<email>|<expiryMs>|<code>")
 *   sig      = HMAC(masterKey, "<email>|<expiryMs>|<codeHmac>").slice(0,32)
 *
 * The cookie carries an HMAC of the expected code (not the code
 * itself), so a leaked cookie does NOT reveal the code. The outer
 * sig guarantees integrity. To verify: re-compute codeHmac with the
 * submitted code; constant-time compare against the cookie value.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const PENDING_COOKIE = 'warp_hub_pending';
const PENDING_TTL_MS = 10 * 60 * 1000;

function masterKey(): string {
  const k = process.env['WARP_VAULT_MASTER_KEY'];
  if (!k) throw new Error('WARP_VAULT_MASTER_KEY not set');
  return k;
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function mintPendingCookie(email: string, code: string): string {
  const normalized = email.trim().toLowerCase();
  const expiry = Date.now() + PENDING_TTL_MS;
  const codeHmac = createHmac('sha256', masterKey())
    .update(`${normalized}|${expiry}|${code}`)
    .digest('hex');
  const sig = createHmac('sha256', masterKey())
    .update(`${normalized}|${expiry}|${codeHmac}`)
    .digest('hex')
    .slice(0, 32);
  return Buffer.from(`${normalized}|${expiry}|${codeHmac}|${sig}`).toString('base64url');
}

export type PendingResult =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly reason: string };

export function verifyPendingCookie(
  raw: string | undefined,
  submittedEmail: string,
  submittedCode: string,
): PendingResult {
  if (!raw) return { ok: false, reason: 'no-pending' };
  if (!/^\d{6}$/.test(submittedCode)) return { ok: false, reason: 'code-format' };

  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'cookie-malformed' };
  }
  const parts = decoded.split('|');
  if (parts.length !== 4) return { ok: false, reason: 'cookie-malformed' };
  const [email, expiryStr, codeHmac, sig] = parts as [string, string, string, string];
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return { ok: false, reason: 'code-expired' };

  const expectedSig = createHmac('sha256', masterKey())
    .update(`${email}|${expiry}|${codeHmac}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expectedSig) return { ok: false, reason: 'cookie-tampered' };

  const submitNormalized = submittedEmail.trim().toLowerCase();
  if (submitNormalized !== email) return { ok: false, reason: 'email-mismatch' };

  const submittedHmac = createHmac('sha256', masterKey())
    .update(`${email}|${expiry}|${submittedCode}`)
    .digest('hex');
  const aBuf = Buffer.from(codeHmac, 'hex');
  const bBuf = Buffer.from(submittedHmac, 'hex');
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    return { ok: false, reason: 'code-mismatch' };
  }
  return { ok: true, email };
}

export function setPendingCookie(cookies: Cookies, value: string): void {
  cookies.set(PENDING_COOKIE, value, {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: Math.floor(PENDING_TTL_MS / 1000),
  });
}

export function readPendingCookie(cookies: Cookies): string | undefined {
  return cookies.get(PENDING_COOKIE) ?? undefined;
}

export function clearPendingCookie(cookies: Cookies): void {
  cookies.set(PENDING_COOKIE, '', { path: '/auth', maxAge: 0 });
}

export const HUB_PENDING_COOKIE = PENDING_COOKIE;
