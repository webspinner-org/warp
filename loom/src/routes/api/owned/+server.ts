/**
 * GET /api/owned
 *
 * Returns the published Webbases the caller owns (filtered by the
 * email on their `warp_author` cookie). Same data the /me page
 * renders server-side, served as JSON so try.webspinner.ai can
 * embed the listing in its own UX.
 *
 * Response shape:
 *   { authed: true,  email, items: [ {id, shortCode, installToken,
 *     appName, domain, version, patronSentence, createdAt, updatedAt,
 *     expiresAt, installCount, maxInstalls, hasPassphrase, originAppId} ] }
 *   { authed: false }   ← caller has no valid author cookie yet
 *
 * The author cookie is minted by /author/login/finish (already
 * proxied through try.webspinner.ai).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { loadAuthorDashboard } from '$lib/server/author-dashboard.js';

export const GET: RequestHandler = async ({ cookies, fetch: f }) => {
  const dash = await loadAuthorDashboard(cookies, f);
  return json(dash);
};
