/**
 * GET /api/storage/files?path=<relpath>
 *
 * Returns the directory listing at <relpath> under HUB_STORAGE_DIR.
 * Auth: requires the warp_hub session cookie (handled by hooks).
 * Path is path-resolved against the storage root; out-of-root
 * requests return 400.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { listDir } from '$lib/server/file-browse.js';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401, 'not-signed-in');
  const rel = url.searchParams.get('path') ?? '';
  const r = await listDir(rel);
  if (!r.ok) {
    const status =
      r.reason === 'out-of-root'
        ? 400
        : r.reason === 'not-found'
          ? 404
          : r.reason === 'not-a-directory'
            ? 400
            : 500;
    return json({ ok: false, reason: r.reason }, { status });
  }
  return json({ ok: true, listing: r.listing });
};
