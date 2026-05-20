/**
 * DELETE /api/sessions/[sessionId]
 *
 * Patron action — remove one of their own sources (built app + its
 * in-progress session). Authorisation: warp_hub cookie email MUST
 * match wp_spinner_sessions.actor_email for this sessionId.
 *
 * Cascade:
 *   - wp_database_applications row (if exists) — removed
 *   - wp_spinner_sessions row — removed
 *   - hub on-disk catalog entry — removed via deleteProjectFromHub
 *
 * Idempotent. Missing rows / directories are not errors.
 *
 * Published versions are NOT deleted by this call — they live in
 * wp_app_packages and have their own DELETE endpoint
 * (/api/published/[shortCode]). The patron can delete the source
 * without revoking already-distributed copies; or vice versa.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { deleteProjectFromHub } from '$lib/server/hub-storage-write.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

interface PBSpinnerSession {
  readonly id: string;
  readonly session_id: string;
  readonly actor_email?: string;
  readonly state: { screensDraft?: { appName?: string } } | null;
}

interface PBDatabaseApp {
  readonly id: string;
  readonly schema_draft: { appName?: string } | null;
}

export const DELETE: RequestHandler = async ({ params, cookies, fetch: f }) => {
  const sessionId = params.sessionId ?? '';
  if (!sessionId) throw error(400, 'sessionId required');

  const hub = getHubSession(cookies);
  if (!hub) throw error(401, 'sign in to delete');

  const token = await loomPbToken(f);
  if (!token) throw error(500, 'pb-auth failed');

  // 1. Load the spinner session and verify ownership.
  const filter = encodeURIComponent(`session_id = ${JSON.stringify(sessionId)}`);
  const sessRes = await f(
    `${PB_URL}/api/collections/wp_spinner_sessions/records?perPage=1&filter=${filter}`,
    { headers: { Authorization: token } },
  );
  if (!sessRes.ok) throw error(502, `pb-list-sessions: ${sessRes.status}`);
  const sessBody = (await sessRes.json()) as { items?: readonly PBSpinnerSession[] };
  const sessRow = sessBody.items?.[0];

  if (sessRow) {
    if (sessRow.actor_email !== hub.email) {
      throw error(403, 'this session belongs to a different patron');
    }
  }
  // No row → it's already gone. Continue, the call remains idempotent.

  let appName = sessRow?.state?.screensDraft?.appName ?? null;

  // 2. Find + delete the db-app row (if built).
  const appRes = await f(
    `${PB_URL}/api/collections/wp_database_applications/records?perPage=1&filter=${filter}`,
    { headers: { Authorization: token } },
  );
  if (appRes.ok) {
    const appBody = (await appRes.json()) as { items?: readonly PBDatabaseApp[] };
    const appRow = appBody.items?.[0];
    if (appRow) {
      if (!appName) appName = appRow.schema_draft?.appName ?? null;
      await f(`${PB_URL}/api/collections/wp_database_applications/records/${appRow.id}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      });
    }
  }

  // 3. Delete the spinner session row.
  if (sessRow) {
    await f(`${PB_URL}/api/collections/wp_spinner_sessions/records/${sessRow.id}`, {
      method: 'DELETE',
      headers: { Authorization: token },
    });
  }

  // 4. Remove the hub-catalog entry (best effort).
  if (appName) {
    await deleteProjectFromHub({ sessionId, appName });
  }

  return json({ ok: true });
};
