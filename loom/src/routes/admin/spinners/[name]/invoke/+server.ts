import { error, json } from '@sveltejs/kit';
import { invoke } from '$lib/server/weaver.js';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
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
