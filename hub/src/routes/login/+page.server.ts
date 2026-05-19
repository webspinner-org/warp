/**
 * GET /login — if already signed in, bounce to /. Otherwise render
 * the login surface. Surfaces any `?error=...` from a failed callback.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { loadOAuthConfig } from '$lib/server/google-oauth.js';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) throw redirect(302, '/');
  const cfg = loadOAuthConfig();
  return {
    oauthConfigured: cfg !== null,
    error: url.searchParams.get('error') ?? null,
  };
};
