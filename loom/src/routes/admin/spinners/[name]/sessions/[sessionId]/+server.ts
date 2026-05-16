// GET /admin/spinners/[name]/sessions/[sessionId] — read the current
// session row for an in-flight or completed Spinner invocation.
//
// Polling endpoint per the Wizard's directive (DEMO-RUNTIME-PLAN.md
// R6): pull, never push. The patron's browser polls this on a
// ~1.5s cadence while a Spinner invocation is in flight. The poll
// IS the heartbeat — if the demo Loom dies, the polls fail and the
// frontend's Observatory surface flags the break. Returns the row
// as { sessionId, spinnerId, phase, state, status, startedAt,
// updatedAt }; the `state.progressLog` array is what the Observatory
// renders. 404 when no row exists yet (first-turn race; the patron's
// browser retries).

import { error, json } from '@sveltejs/kit';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { loadSpinnerSession } from '$lib/server/spinner-session.js';
import type { SpinnerName } from '@webspinner-foundation/sdk';
import type { RequestHandler } from './$types.js';

const ROSTER_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export const GET: RequestHandler = async ({ params, cookies, fetch: f }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');

  // Verify the session is live so a stale cookie doesn't pollute the
  // poll. The proxy refreshes its cookie on 401; the patron experiences
  // it as a transparent re-login.
  let pbToken: string;
  if (session.collection === 'users') {
    const r = await refreshUser(f, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    pbToken = session.token;
  } else {
    const r = await refreshSuperuser(f, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    pbToken = session.token;
  }

  const slug = params.name ?? '';
  const sessionId = params.sessionId ?? '';
  if (!ROSTER_SLUG_PATTERN.test(slug)) {
    throw error(400, `invalid spinner slug: ${slug}`);
  }
  if (sessionId.length === 0 || sessionId.length > 128) {
    throw error(400, 'sessionId required (1–128 chars)');
  }

  // Spinner names in `wp_spinner_sessions` are stored as the full
  // `@scope/slug`. The roster's slug is the bare slug; we map. For v0
  // every roster Spinner is `@webspinner-foundation/<slug>`.
  const fullName = `@webspinner-foundation/${slug}` as SpinnerName;

  const loaded = await loadSpinnerSession(f, pbToken, fullName, sessionId);
  if (!loaded.ok) {
    return json(
      { ok: false, kind: 'backend', status: loaded.status, body: loaded.body },
      { status: 502 },
    );
  }
  if (loaded.row === null) {
    // No row yet — propose may not have written its first save() yet,
    // or this sessionId has never been used. Tell the poller; the
    // browser keeps trying for a few cycles before flagging.
    return json({ ok: true, exists: false }, { status: 200 });
  }

  return json({
    ok: true,
    exists: true,
    session: {
      sessionId: loaded.row.sessionId,
      spinnerId: loaded.row.spinnerId,
      phase: loaded.row.phase,
      state: loaded.row.state,
      status: loaded.row.status,
      startedAt: loaded.row.startedAt,
      updatedAt: loaded.row.updatedAt,
      endedAt: loaded.row.endedAt,
    },
  });
};
