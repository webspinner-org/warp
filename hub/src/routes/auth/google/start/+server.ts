/**
 * GET /auth/google/start — kick off the OAuth flow.
 *   1. Mint a state nonce, stash in a short-lived cookie.
 *   2. 302 to Google's authorize endpoint carrying that state.
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { buildAuthorizeUrl, generateState, loadOAuthConfig } from '$lib/server/google-oauth.js';
import { setOAuthStateCookie } from '$lib/server/hub-session.js';

export const GET: RequestHandler = async ({ cookies }) => {
  const cfg = loadOAuthConfig();
  if (!cfg) throw error(500, 'Google OAuth not configured on this server.');
  const state = generateState();
  setOAuthStateCookie(cookies, state);
  throw redirect(302, buildAuthorizeUrl(cfg, state));
};
