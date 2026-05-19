/**
 * GET /auth/google/callback?code=&state= — close the OAuth loop.
 *   1. Verify `state` matches the cookie minted at /start.
 *   2. Exchange `code` for an `id_token` at Google's token endpoint.
 *   3. Verify the id_token via the tokeninfo endpoint.
 *   4. Mint the warp_hub cookie and 302 to /.
 *
 * Any failure short-circuits to /login?error=<reason> so the patron
 * sees an honest message instead of an opaque 500.
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { exchangeCodeForTokens, loadOAuthConfig, verifyIdToken } from '$lib/server/google-oauth.js';
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setHubCookie,
} from '$lib/server/hub-session.js';

function bounce(reason: string): never {
  throw redirect(302, `/login?error=${encodeURIComponent(reason)}`);
}

export const GET: RequestHandler = async ({ cookies, url, fetch: f }) => {
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const errParam = url.searchParams.get('error');
  if (errParam) bounce(`google: ${errParam}`);
  if (!code || !state) bounce('missing-code-or-state');

  const cookieState = readOAuthStateCookie(cookies);
  clearOAuthStateCookie(cookies);
  if (!cookieState || cookieState !== state) bounce('state-mismatch');

  const cfg = loadOAuthConfig();
  if (!cfg) bounce('oauth-not-configured');

  const exchange = await exchangeCodeForTokens(cfg, code, f);
  if (!exchange.ok) bounce(exchange.reason);

  const verify = await verifyIdToken(cfg, exchange.token.id_token, f);
  if (!verify.ok) bounce(verify.reason);

  const { sub, email, name, picture } = verify.claims;
  setHubCookie(cookies, {
    sub,
    email,
    name: name ?? '',
    picture: picture ?? '',
  });

  throw redirect(302, '/');
};
