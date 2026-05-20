/**
 * GET /api/sessions
 *
 * Returns the spinner sessions that belong to the authed patron — for
 * the try.webspinner.ai session picker. Identity is the warp_hub SSO
 * cookie; sessions are filtered by `actor_email`.
 *
 * Response shape:
 *   { authed: true, email, sessions: [{ sessionId, spinnerId, phase,
 *       appName, domain, updatedAt, status }] }
 *   { authed: false, sessions: [] }
 *
 * Anonymous sessions (no actor_email on the row) are intentionally not
 * returned, even if the caller knows their session id. The picker is a
 * trust-after-sign-in surface; old anonymous sessions stay reachable
 * only via direct URL (and once /api/app/[id] is auth-gated, they
 * will stop being reachable at all).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

interface PBSessionRow {
  readonly id: string;
  readonly spinner_id: string;
  readonly session_id: string;
  readonly actor_email?: string;
  readonly phase: string;
  readonly state: Record<string, unknown> | null;
  readonly status: string;
  readonly updated_at: string;
}

interface PickerSession {
  readonly sessionId: string;
  readonly spinnerId: string;
  readonly phase: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly appName: string | null;
  readonly domain: string | null;
}

function pickAppMeta(state: Record<string, unknown> | null): {
  appName: string | null;
  domain: string | null;
} {
  if (!state) return { appName: null, domain: null };
  const screensDraft = (state['screensDraft'] ?? null) as { appName?: unknown } | null;
  const appName =
    screensDraft && typeof screensDraft === 'object' && typeof screensDraft.appName === 'string'
      ? screensDraft.appName
      : null;
  const domain = typeof state['domain'] === 'string' ? (state['domain'] as string) : null;
  return { appName, domain };
}

export const GET: RequestHandler = async ({ cookies, fetch: f }) => {
  const hub = getHubSession(cookies);
  if (!hub) return json({ authed: false, sessions: [] });

  const token = await loomPbToken(f);
  if (!token) return json({ authed: true, email: hub.email, sessions: [], reason: 'pb-auth' });

  const filter = encodeURIComponent(
    `actor_email = ${JSON.stringify(hub.email)} && status != "aborted"`,
  );
  const url = `${PB_URL}/api/collections/wp_spinner_sessions/records?perPage=50&sort=-updated_at&filter=${filter}`;
  const res = await f(url, { headers: { Authorization: token } });
  if (!res.ok) {
    return json({ authed: true, email: hub.email, sessions: [], reason: `pb-${res.status}` });
  }
  const body = (await res.json()) as { items?: readonly PBSessionRow[] };
  const sessions: PickerSession[] = (body.items ?? []).map((row) => {
    const { appName, domain } = pickAppMeta(row.state);
    return {
      sessionId: row.session_id,
      spinnerId: row.spinner_id,
      phase: row.phase,
      status: row.status,
      updatedAt: row.updated_at,
      appName,
      domain,
    };
  });

  return json({ authed: true, email: hub.email, sessions });
};
