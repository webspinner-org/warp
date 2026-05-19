/**
 * POST /auth/logout — clear the hub cookie and redirect to /login.
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { clearHubCookie } from '$lib/server/hub-session.js';

export const POST: RequestHandler = async ({ cookies }) => {
  clearHubCookie(cookies);
  throw redirect(303, '/login');
};
