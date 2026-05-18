/**
 * GET /me — author dashboard.
 *
 * Reads the warp_author cookie (HMAC-signed verified email) and
 * lists every Webbase the author has published. If no cookie, the
 * page renders a login form (email → 6-digit code → cookie set).
 *
 * Lives at the root of app.webspinner.ai conceptually; SvelteKit
 * just serves it under /me here. (A future +page on /+page.svelte
 * can redirect / → /me when on the app surface.)
 */

import type { PageServerLoad } from './$types.js';
import { getAuthorSession } from '$lib/server/author-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { listPackagesBySender } from '$lib/server/wsap-registry.js';

export const load: PageServerLoad = async ({ cookies, fetch: f }) => {
  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) {
    return { authed: false as const, items: [], reason: 'master-key-missing' };
  }
  const session = getAuthorSession(cookies, masterKey);
  if (!session) {
    return { authed: false as const, items: [] };
  }
  const pbToken = await loomPbToken(f);
  if (!pbToken) {
    return { authed: true as const, email: session.email, items: [], reason: 'pb-auth' };
  }
  const list = await listPackagesBySender({
    senderEmail: session.email,
    fetchFn: f,
    token: pbToken,
  });
  if (!list.ok) {
    return { authed: true as const, email: session.email, items: [], reason: list.reason };
  }
  return { authed: true as const, email: session.email, items: list.items };
};
