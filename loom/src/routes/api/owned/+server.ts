/**
 * GET /api/owned
 *
 * Returns the published Webbases the caller owns (filtered by the
 * email on their cookie). Authoritative identity is the warp_hub
 * SSO cookie (signed by the hub, scoped .webspinner.ai); the older
 * warp_author cookie is honoured as a fallback so in-flight
 * sessions don't break.
 *
 * Response shape:
 *   { authed: true,  email, items: [...] }
 *   { authed: false }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { listPackagesBySender } from '$lib/server/wsap-registry.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { getAuthorSession } from '$lib/server/author-session.js';

export const GET: RequestHandler = async ({ cookies, fetch: f }) => {
  const hub = getHubSession(cookies);
  let email: string | null = hub?.email ?? null;
  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!email && masterKey) {
    const author = getAuthorSession(cookies, masterKey);
    email = author?.email ?? null;
  }
  if (!email) return json({ authed: false, items: [] });

  const pbToken = await loomPbToken(f);
  if (!pbToken) return json({ authed: true, email, items: [], reason: 'pb-auth' });
  const list = await listPackagesBySender({ senderEmail: email, fetchFn: f, token: pbToken });
  if (!list.ok) return json({ authed: true, email, items: [], reason: list.reason });
  return json({ authed: true, email, items: list.items });
};
