/**
 * POST /admin/db-app/[sessionId]/publish
 *
 * Body: { ticket: string }
 *
 * Email-gated export. Steps:
 *   1. Verify the patron's email-verified ticket binds to this
 *      sessionId.
 *   2. Build + sign the .wsap bundle for this session's app
 *      (same code path as /export).
 *   3. Store the bundle in wp_app_packages with a short_code +
 *      install_token, retention 30 days, max 5 installs.
 *   4. Email the patron an install link:
 *        ${PUBLIC_INSTALL_BASE}/install/<shortCode>?t=<install_token>
 *   5. Return { ok, shortCode, installUrl } so the UI can confirm.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { findAppBySessionId } from '$lib/server/database-applications.js';
import { ensureCellIdentity, loadCellKeypair } from '$lib/server/identity.js';
import { buildWsapBundle, signWsapBundle } from '$lib/server/wsap.js';
import { putPackage } from '$lib/server/wsap-registry.js';
import { verifyTicket } from '$lib/server/email-verify.js';
import { sendEmail } from '$lib/server/email-adapter.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ params, request, cookies, fetch: f }) => {
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
  if (!sessionId) throw error(400, 'sessionId required');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const ticket = typeof b['ticket'] === 'string' ? (b['ticket'] as string) : '';
  if (!ticket) throw error(400, 'ticket required');

  const masterKey = env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) throw error(500, 'WARP_VAULT_MASTER_KEY not set');

  // 1. Verify the ticket binds to this sessionId.
  const verified = verifyTicket(ticket, masterKey);
  if (!verified.ok) {
    return json({ ok: false, reason: `ticket: ${verified.reason}` }, { status: 400 });
  }
  if (verified.sessionId !== sessionId) {
    return json({ ok: false, reason: 'ticket-session-mismatch' }, { status: 400 });
  }
  const patronEmail = verified.email;

  // 2. Build + sign the bundle.
  const found = await findAppBySessionId(f, pbToken, sessionId);
  if (!found.ok) throw error(502, `find-app: ${found.body.slice(0, 200)}`);
  if (found.row === null) throw error(404, 'No built app for this session.');
  const row = found.row;

  const ensure = await ensureCellIdentity(f, pbToken, masterKey);
  if (!ensure.ok) throw error(500, `cell-identity: ${JSON.stringify(ensure.error)}`);
  const keypairResult = await loadCellKeypair(f, pbToken, masterKey);
  if (!keypairResult.ok || !keypairResult.value) throw error(500, 'cell-keypair: failed');
  const keypair = keypairResult.value;

  const design = (row as { design?: { screensDraft?: unknown; branding?: unknown } }).design ?? {
    screensDraft: null,
    branding: null,
  };
  const schemaEntities = (row.entities ?? []).map((e) => ({
    name: e.name,
    describes: '',
    fields: (e.fields ?? []).map((f) => ({
      name: f.name,
      kind: f.kind as string,
      describes: f.describes ?? '',
    })),
    links: (e.links ?? []).map((l) => ({ to: l.to, describes: l.describes ?? '' })),
  }));
  const unsigned = buildWsapBundle({
    kind: 'database-application',
    createdBy: {
      cellName: env['WARP_CELL_NAME'] ?? 'Webspinner Cell',
      cellKeyFingerprint: ensure.value.identity.fingerprint,
      cellPublicKeyHex: keypair.publicKeyHex,
      displayName: patronEmail.split('@')[0] ?? undefined,
    },
    createdFrom: {
      patronSentence: row.patronSentence,
      spinnerBundleName: '@webspinner-foundation/database-application',
      spinnerBundleVersion: '0.1.0',
      createdAt: row.builtAt,
      originAppId: row.appId,
    },
    design: {
      screensDraft: design.screensDraft ?? null,
      branding: design.branding ?? null,
    },
    schema: {
      screensDraftVersion: 2,
      entities: schemaEntities,
    },
  });
  const signed = signWsapBundle({
    bundle: unsigned,
    privateKeyHex: keypair.privateKeyHex,
    publicKeyHex: keypair.publicKeyHex,
  });

  // 3. Store in the registry.
  const stored = await putPackage({
    bundle: signed,
    senderEmail: patronEmail,
    fetchFn: f,
    token: pbToken,
  });
  if (!stored.ok) {
    return json({ ok: false, reason: stored.reason }, { status: 500 });
  }

  // 4. Email the install link to the patron.
  const installBase = env['WARP_PUBLIC_INSTALL_BASE'] ?? 'https://try.webspinner.ai';
  const installUrl = `${installBase}/install/${stored.shortCode}?t=${stored.installToken}`;
  const appNameUnknown = (design.screensDraft as { appName?: unknown } | null)?.appName;
  const appName = typeof appNameUnknown === 'string' ? appNameUnknown : 'your application';

  const send = await sendEmail({
    to: patronEmail,
    subject: `Your Webspinner application is ready to install: ${appName}`,
    textBody:
      `Hi —\n\n` +
      `Your Webspinner application ${JSON.stringify(appName)} is packaged and ready to install.\n\n` +
      `Open this link on any Cell to add it to your applications:\n\n` +
      `  ${installUrl}\n\n` +
      `This link is good for up to 5 installs and expires in 30 days. Forward it to anyone you'd like to share the application with.\n\n` +
      `— The Weaver\n  Webspinner Foundation`,
  });

  return json({
    ok: true,
    shortCode: stored.shortCode,
    installToken: stored.installToken,
    installUrl,
    expiresAt: stored.expiresAt,
    emailDelivered: send.ok,
    emailReason: send.ok ? undefined : send.reason,
    patronEmail,
  });
};
