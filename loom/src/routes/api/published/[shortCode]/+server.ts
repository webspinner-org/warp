/**
 * DELETE /api/published/[shortCode]
 *
 * Patron action — remove one of their own published Webbase
 * versions. Authorisation: warp_hub cookie email MUST match
 * wp_app_packages.sender_email for this short_code.
 *
 * Cascade:
 *   - wp_app_packages row — removed (revokes the live URL)
 *   - hub on-disk catalog entry — removed
 *   - wp_app_downloads rows — kept (audit trail; tally remains)
 *
 * Existing downloaded standalone .html files continue to function —
 * they don't depend on the wp_app_packages row at all. Deleting a
 * published version only revokes the hosted URL; copies in the wild
 * are by definition out of our control.
 *
 * Idempotent.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { deletePublishedFromHub } from '$lib/server/hub-storage-write.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

interface PBPackage {
  readonly id: string;
  readonly short_code: string;
  readonly sender_email: string;
  readonly app_name: string;
  readonly version: number;
}

export const DELETE: RequestHandler = async ({ params, cookies, fetch: f }) => {
  const shortCode = params.shortCode ?? '';
  if (!shortCode) throw error(400, 'shortCode required');

  const hub = getHubSession(cookies);
  if (!hub) throw error(401, 'sign in to delete');

  const token = await loomPbToken(f);
  if (!token) throw error(500, 'pb-auth failed');

  const filter = encodeURIComponent(`short_code = ${JSON.stringify(shortCode)}`);
  const res = await f(
    `${PB_URL}/api/collections/wp_app_packages/records?perPage=1&filter=${filter}`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) throw error(502, `pb-list: ${res.status}`);
  const body = (await res.json()) as { items?: readonly PBPackage[] };
  const row = body.items?.[0];

  if (!row) return json({ ok: true }); // already gone — idempotent

  if (row.sender_email !== hub.email) {
    throw error(403, 'this Webbase belongs to a different patron');
  }

  await f(`${PB_URL}/api/collections/wp_app_packages/records/${row.id}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  });

  // Hub on-disk catalog cleanup — best effort.
  if (row.app_name) {
    await deletePublishedFromHub({
      shortCode: row.short_code,
      appName: row.app_name,
      version: row.version,
    });
  }

  return json({ ok: true });
};
