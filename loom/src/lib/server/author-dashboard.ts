/**
 * Shared author-dashboard load logic. Used by:
 *   - `/+page.server.ts` (the root page on app.webspinner.ai)
 *   - `/me/+page.server.ts` (legacy explicit URL; kept working)
 *
 * Returns the same shape both surfaces consume: `{ authed, items,
 * email?, reason? }`.
 */

import type { Cookies } from '@sveltejs/kit';
import { getAuthorSession } from './author-session.js';
import { loomPbToken } from './pocketbase.js';
import { listPackagesBySender, type ListedPackage } from './wsap-registry.js';

export type DashboardData =
  | { authed: false; items: readonly ListedPackage[]; reason?: string }
  | {
      authed: true;
      email: string;
      items: readonly ListedPackage[];
      reason?: string;
    };

export async function loadAuthorDashboard(
  cookies: Cookies,
  fetchFn: typeof fetch,
): Promise<DashboardData> {
  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) return { authed: false, items: [], reason: 'master-key-missing' };
  const session = getAuthorSession(cookies, masterKey);
  if (!session) return { authed: false, items: [] };
  const pbToken = await loomPbToken(fetchFn);
  if (!pbToken) return { authed: true, email: session.email, items: [], reason: 'pb-auth' };
  const list = await listPackagesBySender({
    senderEmail: session.email,
    fetchFn,
    token: pbToken,
  });
  if (!list.ok) return { authed: true, email: session.email, items: [], reason: list.reason };
  return { authed: true, email: session.email, items: list.items };
}
