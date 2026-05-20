/**
 * GET /app/[shortCode]/version?t=<installToken>
 *
 * Returns the current published version + expiresAt for a Webbase.
 * The standalone HTML hits this on open to detect a newer publish
 * and prompt the patron to upgrade. Hosted /run uses the same check
 * implicitly (it always loads the current version).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getPackage } from '$lib/server/wsap-registry.js';
import { loomPbToken } from '$lib/server/pocketbase.js';

export const GET: RequestHandler = async ({ params, url, fetch: f }) => {
  const shortCode = params.shortCode ?? '';
  const installToken = url.searchParams.get('t') ?? '';
  if (!shortCode || !installToken) throw error(400, 'shortCode + t required');

  const pbToken = await loomPbToken(f);
  if (!pbToken) throw error(500, 'PB auth failed');
  const pkg = await getPackage({ shortCode, installToken, fetchFn: f, token: pbToken });
  if (!pkg.ok) {
    return json(
      { ok: false, reason: pkg.reason },
      { status: pkg.reason === 'not-found' ? 404 : 410 },
    );
  }
  // Permissive CORS for this endpoint: the standalone HTML may be
  // running on file:// or any third-party host, and only needs a
  // public read of {version, expiresAt}. No cookies, no auth header.
  return json(
    { ok: true, version: pkg.row.version, expiresAt: pkg.row.expiresAt },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
};
