import { error, json } from '@sveltejs/kit';
import { invoke } from '$lib/server/weaver.js';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { getHubSession } from '$lib/server/hub-session.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, params, cookies, fetch }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');

  // Derive actor identity from the SESSION (server-trusted), not the body.
  let actorEmail: string;
  let actorId: string;
  if (session.collection === 'users') {
    const r = await refreshUser(fetch, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    actorEmail = r.value.record.email;
    actorId = r.value.record.id;
  } else {
    const r = await refreshSuperuser(fetch, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    actorEmail = r.auth.record.email;
    actorId = r.auth.record.id;
  }

  // Public-patron path: when try.webspinner.ai forwards a warp_hub
  // cookie alongside its proxy-superuser session, the real actor is
  // the patron, not the proxy. The wp_session is what authenticates
  // to PocketBase (the proxy's superuser token); the warp_hub email
  // is who the work belongs to. Recording the patron's email on
  // wp_spinner_sessions.actor_email is what lets /api/sessions show
  // them their prior work later.
  const hub = getHubSession(cookies);
  if (hub) {
    actorEmail = hub.email;
    actorId = `patron:${hub.email}`;
  }

  const body = (await request.json()) as {
    capability?: string;
    input?: unknown;
    sessionId?: string;
  };

  if (typeof body.capability !== 'string' || body.capability.length === 0) {
    throw error(400, 'capability required');
  }

  const result = await invoke({
    slug: params.name,
    capability: body.capability,
    input: body.input,
    actorEmail,
    actorId,
    // Multi-turn Spinners (e.g. Database Application's propose →
    // refine → build) need the same sessionId across calls so the
    // `wp_spinner_sessions` row is reused. The Weaver mints a fresh
    // UUID when this is absent (single-turn use).
    ...(typeof body.sessionId === 'string' && body.sessionId.length > 0
      ? { sessionId: body.sessionId }
      : {}),
  });

  if (!result.ok) {
    return json(result, { status: result.kind === 'pending' ? 501 : 400 });
  }
  return json(result);
};
