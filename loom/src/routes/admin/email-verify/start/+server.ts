/**
 * POST /admin/email-verify/start
 *
 * Body: { email: string, sessionId: string }
 *
 * Generates a 6-digit code, hashes it, stores in
 * wp_email_verifications, and emails the code to the patron via the
 * configured email adapter. Caller passes the code back to /finish.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { startEmailVerify } from '$lib/server/email-verify.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, cookies, fetch: f }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');
  let pbToken: string;
  if (session.collection === 'users') {
    const r = await refreshUser(f, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    pbToken = session.token;
  } else {
    const r = await refreshSuperuser(f, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    pbToken = session.token;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b['email'] === 'string' ? (b['email'] as string) : '';
  const sessionId = typeof b['sessionId'] === 'string' ? (b['sessionId'] as string) : '';
  if (!email || !sessionId) throw error(400, 'email and sessionId required');

  const masterKey = env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) throw error(500, 'WARP_VAULT_MASTER_KEY not set');

  const result = await startEmailVerify({
    email,
    sessionId,
    fetchFn: f,
    token: pbToken,
    masterKey,
  });
  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return json({ ok: true, expiresAt: result.expiresAt });
};
