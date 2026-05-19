/**
 * GET /api/me — current signed-in user (or 401 if not signed in).
 * Future surfaces (file browser, etc.) will read this for client
 * rendering; MVP-1 keeps it minimal.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'not-signed-in');
  return json(locals.user);
};
