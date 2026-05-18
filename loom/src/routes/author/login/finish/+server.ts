/**
 * POST /author/login/finish
 *
 * Body: { email: string, code: string }
 *
 * Confirms the 6-digit verification code, sets the author cookie,
 * returns { ok, email }. The cookie is HMAC-signed and good for
 * 7 days; the dashboard at /me consumes it.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { finishEmailVerify } from '$lib/server/email-verify.js';
import { setAuthorCookie } from '$lib/server/author-session.js';
import type { RequestHandler } from './$types.js';

const AUTHOR_SESSION_ID = 'author-login' as const;

export const POST: RequestHandler = async ({ request, cookies, fetch: f }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b['email'] === 'string' ? (b['email'] as string) : '';
  const code = typeof b['code'] === 'string' ? (b['code'] as string) : '';
  if (!email || !code) throw error(400, 'email and code required');

  const masterKey = env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) throw error(500, 'WARP_VAULT_MASTER_KEY not set');

  const pbToken = await loomPbToken(f);
  if (!pbToken) throw error(500, 'PB auth failed');

  const result = await finishEmailVerify({
    email,
    sessionId: AUTHOR_SESSION_ID,
    code,
    fetchFn: f,
    token: pbToken,
    masterKey,
  });
  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, { status: 400 });
  }
  setAuthorCookie(cookies, result.verifiedEmail, masterKey);
  return json({ ok: true, email: result.verifiedEmail });
};
