/**
 * GET /api/file?kind=source|published&id=<id>&path=<subpath>
 *
 * Patron-side file reader. Same authz model as /api/files; returns
 * file content (utf-8) or a binary placeholder.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { readItemFile, type ItemKind } from '$lib/server/patron-file-browse.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

async function patronOwns(
  kind: ItemKind,
  identifier: string,
  email: string,
  f: typeof fetch,
  token: string,
): Promise<boolean> {
  if (kind === 'source') {
    const filter = encodeURIComponent(
      `session_id = ${JSON.stringify(identifier)} && actor_email = ${JSON.stringify(email)}`,
    );
    const r = await f(
      `${PB_URL}/api/collections/wp_spinner_sessions/records?perPage=1&filter=${filter}`,
      { headers: { Authorization: token } },
    );
    if (!r.ok) return false;
    const body = (await r.json()) as { items?: readonly unknown[] };
    return (body.items?.length ?? 0) > 0;
  }
  const filter = encodeURIComponent(
    `short_code = ${JSON.stringify(identifier)} && sender_email = ${JSON.stringify(email)}`,
  );
  const r = await f(
    `${PB_URL}/api/collections/wp_app_packages/records?perPage=1&filter=${filter}`,
    { headers: { Authorization: token } },
  );
  if (!r.ok) return false;
  const body = (await r.json()) as { items?: readonly unknown[] };
  return (body.items?.length ?? 0) > 0;
}

export const GET: RequestHandler = async ({ url, cookies, fetch: f }) => {
  const kind = url.searchParams.get('kind') as ItemKind | null;
  const id = url.searchParams.get('id') ?? '';
  const subpath = url.searchParams.get('path') ?? '';
  if (kind !== 'source' && kind !== 'published') throw error(400, 'kind required');
  if (!id) throw error(400, 'id required');
  if (!subpath) throw error(400, 'path required');

  const hub = getHubSession(cookies);
  if (!hub) throw error(401, 'sign in');
  const token = await loomPbToken(f);
  if (!token) throw error(500, 'pb-auth failed');

  const owned = await patronOwns(kind, id, hub.email, f, token);
  if (!owned) throw error(403, 'this item belongs to a different patron');

  const r = await readItemFile(kind, id, subpath);
  if (!r.ok) {
    return json(
      { ok: false, reason: r.reason },
      { status: r.reason === 'item-not-found' ? 404 : 400 },
    );
  }
  return json(r);
};
