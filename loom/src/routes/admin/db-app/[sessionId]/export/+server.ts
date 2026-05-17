/**
 * GET /admin/db-app/[sessionId]/export — emit a signed `.wsap`
 * Webspinner Application Package for the patron's built app.
 *
 * v0.1 per ~/warp/APP-PORTABILITY.md. Carries design + derived
 * schema + provenance + ed25519 signature. No data.
 *
 * Auth: the patron's session cookie (Wizard or demo Webspinner).
 * Auth pattern mirrors the sibling `+server.ts` (app metadata).
 */

import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { findAppBySessionId } from '$lib/server/database-applications.js';
import { ensureCellIdentity, loadCellKeypair } from '$lib/server/identity.js';
import { buildWsapBundle, signWsapBundle } from '$lib/server/wsap.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params, cookies, fetch: f, request }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');

  // Same auth dance as the sibling app-metadata route.
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
  if (!found.ok) throw error(502, `find-app: ${found.body.slice(0, 200)}`);
  if (found.row === null) throw error(404, 'No built app for this session.');
  const row = found.row;

  // The Cell identity is required to sign the bundle. The vault
  // master key lives in the loom-demo / loom-operator plist env.
  const masterKey = env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) throw error(500, 'WARP_VAULT_MASTER_KEY not set on this Loom.');
  const ensure = await ensureCellIdentity(f, pbToken, masterKey);
  if (!ensure.ok) throw error(500, `cell-identity: ${JSON.stringify(ensure.error)}`);
  const keypairResult = await loadCellKeypair(f, pbToken, masterKey);
  if (!keypairResult.ok || !keypairResult.value) {
    throw error(500, 'cell-keypair: failed to load');
  }
  const keypair = keypairResult.value;

  // Map the row's design + entities into the wsap shapes.
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

  // Filename suggests {appName}-{appId}.wsap; safe-encode appName.
  const appName =
    typeof (design.screensDraft as { appName?: unknown } | null)?.appName === 'string'
      ? (design.screensDraft as { appName: string }).appName
      : 'application';
  const safeName =
    appName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'application';
  const filename = `${safeName}-${row.appId}.wsap`;
  void request; // unused — kept for symmetry with sibling routes

  return new Response(JSON.stringify(signed, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-webspinner-app+json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};
