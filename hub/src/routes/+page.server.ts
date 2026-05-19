/**
 * GET / — hub root. Requires an authenticated session; redirect
 * unauth visitors to /login. MVP-1: just renders the empty root.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/login');
  return {
    user: locals.user,
  };
};
