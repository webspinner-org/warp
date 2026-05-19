/**
 * GET / — hub front door. Always renders; the page itself decides
 * between the splash, the login form, and (when authed) the root
 * tree listing.
 */

import type { PageServerLoad } from './$types.js';
import { listTreeAt } from '$lib/server/hub-storage.js';

export const load: PageServerLoad = async ({ locals }) => {
  const authed = locals.user !== null;
  const children = authed ? await listTreeAt([]) : [];
  return { authed, user: locals.user, children };
};
