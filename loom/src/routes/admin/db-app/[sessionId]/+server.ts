// GET /admin/db-app/[sessionId] — read the built Database
// Application's metadata for a given Spinner session. Returns
// { ok: true, app: { appId, sessionId, domain, patronSentence,
// entities[], builtAt } } or { ok: true, app: null } if the patron's
// session hasn't called `build` yet.
//
// The FastAPI proxy on try.webspinner.ai queries this after a
// successful build invocation to render the patron's working app
// in the Observatory's app-mode view.

import { error, json } from '@sveltejs/kit';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { findAppBySessionId } from '$lib/server/database-applications.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params, cookies, fetch: f }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');

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

  const sessionId = params.sessionId ?? '';
  if (sessionId.length === 0 || sessionId.length > 128) {
    throw error(400, 'sessionId required (1–128 chars)');
  }

  const found = await findAppBySessionId(f, pbToken, sessionId);
  if (!found.ok) {
    return json(
      { ok: false, kind: 'backend', status: found.status, body: found.body },
      { status: 502 },
    );
  }
  if (found.row === null) {
    return json({ ok: true, app: null });
  }

  return json({
    ok: true,
    app: {
      appId: found.row.appId,
      sessionId: found.row.sessionId,
      domain: found.row.domain,
      patronSentence: found.row.patronSentence,
      entities: found.row.entities,
      builtAt: found.row.builtAt,
      status: found.row.status,
    },
  });
};
