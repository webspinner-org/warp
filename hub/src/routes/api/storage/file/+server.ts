/**
 * GET /api/storage/file?path=<relpath>
 *
 * Returns the contents of a single file under HUB_STORAGE_DIR, or
 * a binary placeholder for non-text / oversized files. Always JSON.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { readFile } from '$lib/server/file-browse.js';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401, 'not-signed-in');
  const rel = url.searchParams.get('path') ?? '';
  const r = await readFile(rel);
  if (!('ok' in r) || r.ok !== true) {
    const reason = (r as { reason: string }).reason;
    const status = reason === 'out-of-root' ? 400 : reason === 'not-found' ? 404 : 500;
    return json({ ok: false, reason }, { status });
  }
  return json(r);
};
