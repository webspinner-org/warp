/**
 * GET /app/[shortCode]/bundle?t=<install_token>
 *
 * Returns the raw signed Webbase bundle JSON from the registry. The
 * +page client fetches this, then POSTs it to /admin/db-app/import
 * to materialize the Webbase in the recipient's Cell. No Loom
 * session required to read; the install_token is the capability.
 */

import { error, json } from '@sveltejs/kit';
import { getPackage } from '$lib/server/wsap-registry.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params, url, fetch: f }) => {
  const shortCode = params.shortCode ?? '';
  const installToken = url.searchParams.get('t') ?? '';
  if (!shortCode || !installToken) throw error(400, 'shortCode and t required');

  const pbToken = await loomPbToken(f);
  if (!pbToken) throw error(500, 'PB auth failed');

  const pkg = await getPackage({
    shortCode,
    installToken,
    fetchFn: f,
    token: pbToken,
  });
  if (!pkg.ok) {
    return json(
      { ok: false, reason: pkg.reason },
      { status: pkg.reason === 'not-found' ? 404 : 410 },
    );
  }
  return json(pkg.row.bundle);
};
