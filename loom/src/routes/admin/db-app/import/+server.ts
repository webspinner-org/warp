/**
 * POST /admin/db-app/import — install a `.wsap` Webspinner
 * Application Package into this Cell. v0.1 per
 * ~/warp/APP-PORTABILITY.md.
 *
 * Verifies the bundle's signature (self-attesting; bundle carries
 * its own public key under createdBy.cellPublicKeyHex), creates a
 * new appId, derives the schema from the bundle's screensDraft,
 * creates the per-entity PB collections, and writes a fresh row
 * in wp_database_applications with sessionId = `import-<random>`.
 *
 * Trust in the bundle's public key is out-of-band — the patron's
 * UI should display the fingerprint + author cell-name before
 * accepting. v0.1 doesn't lock down which keys are accepted; the
 * receiving patron is the gate.
 */

import { error, json } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { createApp } from '$lib/server/database-applications.js';
import { verifyWsapBundle } from '$lib/server/wsap.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, cookies, fetch: f }) => {
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

  let bundle: unknown;
  try {
    bundle = await request.json();
  } catch {
    throw error(400, 'Request body must be a JSON object (the .wsap bundle).');
  }
  if (!bundle || typeof bundle !== 'object') {
    throw error(400, 'Request body must be a JSON object (the .wsap bundle).');
  }

  // Verify the bundle's signature against its self-attested public
  // key. The patron-facing UI should also display the fingerprint
  // before letting the patron commit.
  const verifyResult = verifyWsapBundle({ bundle });
  if (!verifyResult.ok) {
    return json({ ok: false, kind: 'verify-failed', reason: verifyResult.reason }, { status: 400 });
  }

  // Pull the bits createApp needs out of the bundle.
  const b = bundle as Record<string, unknown>;
  const design = b['design'] as { screensDraft?: unknown; branding?: unknown } | undefined;
  if (!design || !design.screensDraft) {
    return json({ ok: false, kind: 'bundle-malformed', reason: 'missing-design' }, { status: 400 });
  }
  const createdFrom = (b['createdFrom'] ?? {}) as Record<string, unknown>;
  const patronSentence =
    typeof createdFrom['patronSentence'] === 'string'
      ? (createdFrom['patronSentence'] as string)
      : '';
  const domain =
    typeof (design.screensDraft as { domain?: unknown }).domain === 'string'
      ? (design.screensDraft as { domain: string }).domain
      : 'imported-app';
  const spinnerId =
    typeof createdFrom['spinnerBundleName'] === 'string'
      ? (createdFrom['spinnerBundleName'] as string)
      : '@webspinner-foundation/database-application';

  // Imported apps get a synthesised sessionId so they round-trip
  // through the existing per-session lookups + queries. Format is
  // distinguishable from real demo sessions (which start `demo-`).
  const importSessionId = `import-${randomBytes(8).toString('hex')}`;

  const created = await createApp({
    fetchFn: f,
    token: pbToken,
    sessionId: importSessionId,
    spinnerId,
    patronSentence,
    domain,
    design: {
      screensDraft: design.screensDraft as Parameters<
        typeof createApp
      >[0]['design']['screensDraft'],
      branding: (design.branding ?? null) as Parameters<typeof createApp>[0]['design']['branding'],
    },
  });

  if (!created.ok) {
    if (created.kind === 'already-built') {
      // Shouldn't happen — synthesised sessionId is random — but
      // guard the case explicitly.
      return json(
        { ok: false, kind: 'already-built', appId: created.existing.appId },
        { status: 409 },
      );
    }
    return json({ ok: false, kind: 'install-failed', detail: created.detail }, { status: 500 });
  }

  const row = created.row;
  return json({
    ok: true,
    appId: row.appId,
    sessionId: importSessionId,
    deployedSurfaceUrl: `/db-app/${row.appId}`,
    importedFrom: {
      cellName: (b['createdBy'] as { cellName?: string } | undefined)?.cellName ?? null,
      cellKeyFingerprint:
        (b['createdBy'] as { cellKeyFingerprint?: string } | undefined)?.cellKeyFingerprint ?? null,
      originAppId: (createdFrom['originAppId'] as string | undefined) ?? null,
      createdAt: (createdFrom['createdAt'] as string | undefined) ?? null,
      patronSentence,
    },
  });
};
