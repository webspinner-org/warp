import { error, json } from '@sveltejs/kit';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser, loomPbToken } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { signSpinnerBundle } from '$lib/server/spinner-sign-op.js';
import type { OperationActor } from '$lib/server/operations.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, cookies, fetch }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');

  let actorEmail: string;
  let actorId: string;
  let actorKind: OperationActor['kind'];
  if (session.collection === 'users') {
    const r = await refreshUser(fetch, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    actorEmail = r.value.record.email;
    actorId = r.value.record.id;
    actorKind = 'webspinner';
  } else {
    const r = await refreshSuperuser(fetch, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    actorEmail = r.auth.record.email;
    actorId = r.auth.record.id;
    actorKind = 'wizard';
  }

  const body = (await request.json()) as { bundlePath?: string };
  if (typeof body.bundlePath !== 'string' || body.bundlePath.length === 0) {
    throw error(400, 'bundlePath required');
  }

  // Bearer for Loom-privileged operations (vault, identity, audit,
  // operations) is the Loom's superuser token from loomPbToken —
  // NOT session.token. User-collection JWTs don't bypass PB
  // collection rules. Actor stays session-derived.
  const pbToken = await loomPbToken(fetch);
  if (!pbToken) {
    throw error(500, 'Loom PB credentials missing — set WARP_PB_EMAIL/PASSWORD.');
  }
  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) {
    throw error(500, 'WARP_VAULT_MASTER_KEY is not set on the Loom — the vault is sealed.');
  }

  const result = await signSpinnerBundle({
    bundlePath: body.bundlePath,
    actor: { kind: actorKind, id: actorId, email: actorEmail },
    fetch,
    pbToken,
    masterKey,
  });

  if (!result.ok) {
    return json(result, { status: 400 });
  }
  return json(result);
};
