/**
 * GET /api/sessions
 *
 * Returns the apps that belong to the authed patron — for the
 * try.webspinner.ai picker. The primary key is the *patron*; the
 * session id is an implementation detail per row. Mirrors what hub
 * shows under "Try Webspinner Projects → Webbase App".
 *
 * Sources two PB tables and merges:
 *   - wp_database_applications  — built apps (rich metadata; kind='built')
 *   - wp_spinner_sessions       — in-progress propose/refine/ready rows
 *                                 with no built app yet (kind='in-progress')
 *
 * The bridge between the two is `session_id`. We filter at the
 * spinner_sessions layer (where actor_email lives) and use that set
 * of session_ids to retrieve the corresponding built apps.
 *
 * Response shape:
 *   { authed: true, email, sessions: [{
 *       sessionId, appName, domain, kind, status, updatedAt, builtAt
 *   }] }
 *   { authed: false, sessions: [] }
 *
 * Anonymous spinner_sessions rows (no actor_email) are intentionally
 * not returned, even when the caller knows their session id. The
 * picker is a trust-after-sign-in surface.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

interface PBSpinnerSessionRow {
  readonly id: string;
  readonly spinner_id: string;
  readonly session_id: string;
  readonly actor_email?: string;
  readonly phase: string;
  readonly state: Record<string, unknown> | null;
  readonly status: string;
  readonly updated_at: string;
}

interface PBDatabaseApplicationRow {
  readonly id: string;
  readonly session_id: string;
  readonly domain: string;
  readonly schema_draft: { appName?: string } | null;
  readonly built_at: string;
  readonly status: string;
  readonly updated: string;
}

interface PickerEntry {
  readonly sessionId: string;
  readonly appName: string;
  readonly domain: string | null;
  readonly kind: 'built' | 'in-progress';
  readonly status: string;
  readonly updatedAt: string;
  readonly builtAt: string | null;
}

function pickInProgressAppName(row: PBSpinnerSessionRow): {
  appName: string;
  domain: string | null;
} {
  const state = row.state;
  if (!state) return { appName: '(untitled)', domain: null };
  const screensDraft = (state['screensDraft'] ?? null) as { appName?: unknown } | null;
  const fromScreens =
    screensDraft && typeof screensDraft === 'object' && typeof screensDraft.appName === 'string'
      ? screensDraft.appName
      : null;
  const domain = typeof state['domain'] === 'string' ? (state['domain'] as string) : null;
  return { appName: fromScreens || domain || '(untitled)', domain };
}

export const GET: RequestHandler = async ({ cookies, fetch: f }) => {
  const hub = getHubSession(cookies);
  if (!hub) return json({ authed: false, sessions: [] });

  const token = await loomPbToken(f);
  if (!token) return json({ authed: true, email: hub.email, sessions: [], reason: 'pb-auth' });

  // 1. The patron's spinner sessions. This filter is the *trust* point —
  //    only rows tagged with the patron's email are visible to them.
  const sessionFilter = encodeURIComponent(
    `actor_email = ${JSON.stringify(hub.email)} && status != "aborted"`,
  );
  const sessionsUrl = `${PB_URL}/api/collections/wp_spinner_sessions/records?perPage=200&sort=-updated_at&filter=${sessionFilter}`;
  const sessionsRes = await f(sessionsUrl, { headers: { Authorization: token } });
  if (!sessionsRes.ok) {
    return json({
      authed: true,
      email: hub.email,
      sessions: [],
      reason: `pb-sessions-${sessionsRes.status}`,
    });
  }
  const sessionsBody = (await sessionsRes.json()) as { items?: readonly PBSpinnerSessionRow[] };
  const spinnerSessions = sessionsBody.items ?? [];

  // 2. Built apps backing those sessions. Single filter with `||` OR
  //    matches PocketBase's filter dialect; cheaper than N round-trips.
  const builtBySessionId = new Map<string, PBDatabaseApplicationRow>();
  if (spinnerSessions.length > 0) {
    const orClauses = spinnerSessions
      .map((s) => `session_id = ${JSON.stringify(s.session_id)}`)
      .join(' || ');
    const appsUrl = `${PB_URL}/api/collections/wp_database_applications/records?perPage=200&filter=${encodeURIComponent(orClauses)}`;
    const appsRes = await f(appsUrl, { headers: { Authorization: token } });
    if (appsRes.ok) {
      const appsBody = (await appsRes.json()) as { items?: readonly PBDatabaseApplicationRow[] };
      for (const row of appsBody.items ?? []) {
        builtBySessionId.set(row.session_id, row);
      }
    }
    // Soft-fail on app lookup — patron still sees in-progress entries.
  }

  // 3. Merge. Each spinner session becomes one entry. The rich
  //    patron-blessed appName lives in wp_spinner_sessions.state.
  //    screensDraft.appName — that's what hub shows in its catalog,
  //    and that's the canonical display name. Fall back to the built
  //    app's derived schema name (often lowercased) and then domain.
  const entries: PickerEntry[] = spinnerSessions.map((s) => {
    const { appName: sessionAppName, domain: sessionDomain } = pickInProgressAppName(s);
    const built = builtBySessionId.get(s.session_id);
    if (built) {
      const richName =
        (sessionAppName && sessionAppName !== '(untitled)' ? sessionAppName : null) ||
        built.schema_draft?.appName ||
        built.domain ||
        '(untitled)';
      return {
        sessionId: s.session_id,
        appName: richName,
        domain: built.domain ?? sessionDomain ?? null,
        kind: 'built',
        status: 'built',
        updatedAt: built.updated || s.updated_at,
        builtAt: built.built_at,
      };
    }
    return {
      sessionId: s.session_id,
      appName: sessionAppName,
      domain: sessionDomain,
      kind: 'in-progress',
      status: s.phase || s.status,
      updatedAt: s.updated_at,
      builtAt: null,
    };
  });

  // 4. Sort by recency (most recent first). Built rows use built_at;
  //    in-progress rows use their updated_at — both already populated.
  entries.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  return json({ authed: true, email: hub.email, sessions: entries });
};
