/**
 * POST /author/login/start
 *
 * Body: { email: string }
 *
 * Begin email verification for the author dashboard at /me. No
 * pre-existing Loom session required. Uses a constant session_id
 * binding (`author-login`) so resends find the same pending row.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { startEmailVerify } from '$lib/server/email-verify.js';
import type { RequestHandler } from './$types.js';

const AUTHOR_SESSION_ID = 'author-login' as const;

export const POST: RequestHandler = async ({ request, fetch: f }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b['email'] === 'string' ? (b['email'] as string) : '';
  if (!email) throw error(400, 'email required');

  const masterKey = env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) throw error(500, 'WARP_VAULT_MASTER_KEY not set');

  const pbToken = await loomPbToken(f);
  if (!pbToken) throw error(500, 'PB auth failed');

  const result = await startEmailVerify({
    email,
    sessionId: AUTHOR_SESSION_ID,
    fetchFn: f,
    token: pbToken,
    masterKey,
  });
  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return json({ ok: true, expiresAt: result.expiresAt });
};
