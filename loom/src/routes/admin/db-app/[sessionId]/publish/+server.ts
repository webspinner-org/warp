/**
 * POST /admin/db-app/[sessionId]/publish
 *
 * Body: { ticket: string, passphrase?: string }
 *
 * Email-gated Webbase publish. Steps:
 *   1. Verify the patron's email-verified ticket binds to this
 *      sessionId.
 *   2. Build + sign the Webbase bundle for this session's app.
 *   3. UPSERT it into wp_app_packages by
 *      (cell_key_fingerprint, origin_app_id) so re-publishes keep
 *      the same short_code + install_token → same URL.
 *   4. Email the patron an Open link:
 *        ${PUBLIC_APP_BASE}/app/<shortCode>?t=<install_token>
 *   5. Return { ok, shortCode, installToken, openUrl, action }.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { findAppBySessionId, snapshotEntityRecords } from '$lib/server/database-applications.js';
import { ensureCellIdentity, loadCellKeypair } from '$lib/server/identity.js';
import { buildWsapBundle, signWsapBundle } from '$lib/server/wsap.js';
import { upsertPackage } from '$lib/server/wsap-registry.js';
import { writePublishedWebbaseToHub } from '$lib/server/hub-storage-write.js';
import { verifyTicket } from '$lib/server/email-verify.js';
import { sendEmail } from '$lib/server/email-adapter.js';
import { setAuthorCookie } from '$lib/server/author-session.js';
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
  const passphraseRaw = b['passphrase'];
  const passphrase =
    typeof passphraseRaw === 'string' && passphraseRaw.length > 0
      ? (passphraseRaw as string)
      : undefined;
  // Block-11 — opt-in checkbox in the Publish modal. When true, the
  // bundle carries a snapshot of every entity collection so the
  // recipient sees pre-populated records on first open.
  const includeSampleData = b['includeSampleData'] === true;
  if (!ticket) throw error(400, 'ticket required');

  const masterKey = env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) throw error(500, 'WARP_VAULT_MASTER_KEY not set');

  // 1. Verify ticket binds to this sessionId.
  const verified = verifyTicket(ticket, masterKey);
  if (!verified.ok) {
    return json({ ok: false, reason: `ticket: ${verified.reason}` }, { status: 400 });
  }
  if (verified.sessionId !== sessionId) {
    return json({ ok: false, reason: 'ticket-session-mismatch' }, { status: 400 });
  }
  const patronEmail = verified.email;

  // 2. Build + sign.
  const found = await findAppBySessionId(f, pbToken, sessionId);
  if (!found.ok) throw error(502, `find-app: ${found.body.slice(0, 200)}`);
  if (found.row === null) throw error(404, 'No built Webbase for this session.');
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
    fields: (e.fields ?? []).map((field) => ({
      name: field.name,
      kind: field.kind as string,
      describes: field.describes ?? '',
    })),
    links: (e.links ?? []).map((l) => ({ to: l.to, describes: l.describes ?? '' })),
  }));
  // Block-11 — snapshot records when opt-in. Stored in a SIBLING
  // wp_app_packages.sample_records column, NOT inside the signed
  // wsap_json bundle. Sample data is a deploy-time decoration; it
  // shouldn't bump the bundle's signed digest and the empirical
  // test (2026-05-21) showed PB drops nested data keys inside the
  // wsap_json JSON column for reasons we haven't fully isolated.
  // A sibling column sidesteps that entirely.
  //
  // `sampleRecords: null` on the upsert input means "clear this
  // column on update" — so an unchecked checkbox on a re-publish
  // strips the prior sample data.
  let sampleRecordsForUpsert: Record<string, readonly Record<string, unknown>[]> | null = null;
  if (includeSampleData && row.entities.length > 0) {
    const snap = await snapshotEntityRecords(f, pbToken, row.entities);
    if (snap.ok) {
      sampleRecordsForUpsert = snap.bySlug;
    } else {
      process.stderr.write(
        `[publish] sample-data snapshot failed: ${snap.status} ${snap.body.slice(0, 200)}\n`,
      );
    }
  }

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

  const appNameUnknown = (design.screensDraft as { appName?: unknown } | null)?.appName;
  const appName = typeof appNameUnknown === 'string' ? (appNameUnknown as string) : '';
  const domainUnknown = (design.screensDraft as { domain?: unknown } | null)?.domain;
  const domain = typeof domainUnknown === 'string' ? (domainUnknown as string) : '';

  // 3. UPSERT — re-publishes update the same row so URLs stay stable.
  const stored = await upsertPackage({
    bundle: signed,
    senderEmail: patronEmail,
    cellKeyFingerprint: ensure.value.identity.fingerprint,
    originAppId: row.appId,
    appName,
    domain,
    passphrase,
    // Block-11 — null on opt-out clears any prior sample data on
    // re-publish, so the patron can toggle the share between
    // populated and empty across consecutive publishes.
    sampleRecords: sampleRecordsForUpsert,
    fetchFn: f,
    token: pbToken,
  });
  if (!stored.ok) {
    return json({ ok: false, reason: stored.reason }, { status: 500 });
  }

  // 4. Side-write the published webbase into the hub catalog under
  // published-work/webbase-app/<shortCode>/. Failure is swallowed —
  // the wp_app_packages row + email still go through; the hub
  // re-syncs on next publish or via the bootstrap tool.
  const appBase = env['WARP_PUBLIC_APP_BASE'] ?? 'https://app.webspinner.ai';
  const openUrl = `${appBase}/app/${stored.shortCode}?t=${stored.installToken}`;
  const nowIso = new Date().toISOString();
  await writePublishedWebbaseToHub({
    meta: {
      shortCode: stored.shortCode,
      appName: appName || '(unnamed Webbase)',
      domain,
      version: stored.version,
      senderEmail: patronEmail,
      cellName: env['WARP_CELL_NAME'] ?? 'Webspinner Cell',
      cellKeyFingerprint: ensure.value.identity.fingerprint,
      originAppId: row.appId,
      patronSentence: row.patronSentence,
      hasPassphrase: passphrase !== undefined && passphrase.length > 0,
      openUrl,
      installCount: 0,
      maxInstalls: 5,
      expiresAt: stored.expiresAt,
      createdAt: stored.action === 'created' ? nowIso : (row.builtAt ?? nowIso),
      updatedAt: nowIso,
    },
    bundle: signed,
  });

  // 5. Mint the warp_author cookie so the patron is auto-signed-in
  // for the "Your Webbases" panel + the app.webspinner.ai/me dashboard
  // on subsequent visits — they verified email a moment ago, no
  // reason to ask again.
  setAuthorCookie(cookies, patronEmail, masterKey);

  // 6. Email the Open link.
  const displayName = appName || 'your Webbase';

  const isUpdate = stored.action === 'updated';
  const subjectVerb = isUpdate ? 'updated' : 'ready';
  const send = await sendEmail({
    to: patronEmail,
    subject: `Your Webbase is ${subjectVerb}: ${displayName}`,
    textBody:
      `Hi —\n\n` +
      (isUpdate
        ? `Your Webbase ${JSON.stringify(displayName)} has a new version (v${stored.version}) live at the same Open link.\n\n`
        : `Your Webbase ${JSON.stringify(displayName)} is published and ready to share.\n\n`) +
      `Open it any time:\n\n` +
      `  ${openUrl}\n\n` +
      `You can see this Webbase and any others you've published at:\n\n` +
      `  ${appBase}\n\n` +
      (isUpdate
        ? `Anyone you already shared the link with will see the latest version on their next visit.\n\n`
        : `Forward the Open link to anyone you'd like to share it with. They can open it in their own Cell.\n\n`) +
      `— The Weaver\n  Webspinner Foundation`,
  });

  return json({
    ok: true,
    action: stored.action,
    shortCode: stored.shortCode,
    installToken: stored.installToken,
    openUrl,
    installUrl: openUrl, // back-compat for older clients still reading installUrl
    version: stored.version,
    expiresAt: stored.expiresAt,
    emailDelivered: send.ok,
    emailReason: send.ok ? undefined : send.reason,
    patronEmail,
  });
};
