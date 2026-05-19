/**
 * GET / — hub front door. Always renders; the page itself decides
 * between the splash, the login form, and the empty-root view based
 * on session state.
 */

import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  return {
    authed: locals.user !== null,
    user: locals.user,
  };
};
