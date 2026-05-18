/**
 * POST /author/logout
 *
 * Clears the author cookie. Patron can re-login at /me.
 */

import { json } from '@sveltejs/kit';
import { clearAuthorCookie } from '$lib/server/author-session.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ cookies }) => {
  clearAuthorCookie(cookies);
  return json({ ok: true });
};
