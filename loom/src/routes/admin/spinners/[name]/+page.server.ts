import { error, fail } from '@sveltejs/kit';
import { loadSpinner, loadSpinnerDoc } from '$lib/server/spinners.js';
import { renderMarkdown } from '$lib/server/markdown.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { readSilkPattern, ensureSilkPatternCollection } from '$lib/server/silk-pattern.js';
import { spoolDisplayName } from '$lib/server/spools.js';
import { getCellIdentity } from '$lib/server/identity.js';
import {
  ensureSkeinCollection,
  getSkein,
  updateIntegrityStatus,
  computeIntegrity,
  type SkeinRow,
} from '$lib/server/skein.js';
import { ensureAuditCollection, writeAuditEvent } from '$lib/server/audit.js';
import {
  writeOperation,
  operationActorToAuditActor,
  type OperationActor,
} from '$lib/server/operations.js';
import type { Actions, PageServerLoad } from './$types.js';

interface SkeinPanel {
  readonly source: string;
  readonly recordedDigest: string;
  readonly integrityStatus: string;
  readonly lastIntegrityCheck: string;
  readonly installedAt: string;
  readonly installedBy: string;
  readonly signerCount: number;
  readonly signers: readonly { fingerprint: string; signerLabel: string; signedAt: string }[];
}

function skeinPanelFromRow(row: SkeinRow): SkeinPanel {
  return {
    source: row.source,
    recordedDigest: row.recordedDigest,
    integrityStatus: row.integrityStatus,
    lastIntegrityCheck: row.lastIntegrityCheck,
    installedAt: row.installedAt,
    installedBy: row.installedBy,
    signerCount: row.signers.length,
    signers: row.signers.map((s) => ({
      fingerprint: s.fingerprint,
      signerLabel: s.signerLabel,
      signedAt: s.signedAt,
    })),
  };
}

export const load: PageServerLoad = async ({ params, fetch, parent }) => {
  const layoutData = await parent();

  const result = await loadSpinner(params.name);
  if (!result.ok) {
    if (result.error.kind === 'not-found') {
      throw error(404, `No Spinner named "${params.name}" is registered.`);
    }
    if (result.error.kind === 'manifest-missing') {
      throw error(500, `Spinner "${params.name}" has no manifest.json on disk.`);
    }
    throw error(500, `Spinner "${params.name}" manifest invalid: ${result.error.detail}`);
  }

  const { manifest, bundleDir, integrity } = result.value;
  const howItWorksRaw = await loadSpinnerDoc(bundleDir, manifest.documentation.howItWorks);
  const readmeRaw = manifest.documentation.readme
    ? await loadSpinnerDoc(bundleDir, manifest.documentation.readme)
    : undefined;
  const missionLockRaw = await loadSpinnerDoc(bundleDir, 'mission-lock.md');

  // Silk Pattern (best-effort).
  let silkPattern = null;
  let skeinPanel: SkeinPanel | null = null;
  try {
    const pbToken = await loomPbToken(fetch);
    if (pbToken) {
      await ensureSilkPatternCollection(fetch, pbToken);
      silkPattern = await readSilkPattern(fetch, pbToken, manifest.name);

      await ensureSkeinCollection(fetch, pbToken);
      const skeinRow = await getSkein(fetch, pbToken, params.name);
      if (skeinRow.ok && skeinRow.row) {
        skeinPanel = skeinPanelFromRow(skeinRow.row);
      }
    }
  } catch {
    silkPattern = null;
  }

  const spoolDisplay = manifest.spools.map((ref) => ({
    name: ref.name,
    spool: ref.spool,
    spoolDisplayName: spoolDisplayName(ref.spool) ?? '(unknown)',
    required: ref.required,
  }));

  return {
    slug: result.value.slug,
    manifest,
    integrity,
    skein: skeinPanel,
    spoolDisplay,
    silkPattern,
    docs: {
      howItWorksHtml: howItWorksRaw ? renderMarkdown(howItWorksRaw) : undefined,
      readmeHtml: readmeRaw ? renderMarkdown(readmeRaw) : undefined,
      missionLockHtml: missionLockRaw ? renderMarkdown(missionLockRaw) : undefined,
    },
    actor: {
      email: layoutData.user.email,
      id: layoutData.user.id,
    },
  };
};

export const actions: Actions = {
  // Form action: refresh integrity status for this Spinner.
  // Reads the wp_skein row, recomputes integrity against disk, updates
  // the row, writes a wp_operations envelope + wp_audit event.
  refreshIntegrity: async ({ params, fetch, cookies }) => {
    const session = cookies.get('wp_session');
    if (!session) return fail(401, { error: 'not-authenticated' });

    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });

    // Resolve actor from session (simplified: superuser for now).
    const actor: OperationActor = {
      kind: 'wizard',
      id: 'refresh-integrity-action',
    };

    const startedAt = new Date().toISOString();

    const ensured = await ensureSkeinCollection(fetch, pbToken);
    if (!ensured.ok) return fail(500, { error: 'skein-ensure-failed' });

    const skeinResult = await getSkein(fetch, pbToken, params.name);
    if (!skeinResult.ok) return fail(500, { error: 'skein-read-failed' });
    if (!skeinResult.row) return fail(404, { error: 'no-skein-row' });
    const row = skeinResult.row;

    const loaded = await loadSpinner(params.name);
    if (!loaded.ok) return fail(500, { error: 'manifest-load-failed' });

    const previousStatus = row.integrityStatus;
    const verdict = await computeIntegrity(row.bundlePath, loaded.value.manifest);
    const checkedAt = new Date().toISOString();

    const updated = await updateIntegrityStatus(
      fetch,
      pbToken,
      params.name,
      verdict.status,
      checkedAt,
    );
    if (!updated.ok) return fail(500, { error: 'skein-update-failed' });

    // Operation envelope.
    const opWrite = await writeOperation(fetch, pbToken, {
      kind: 'spinner.integrity-check',
      status: verdict.status === 'verified' ? 'ok' : 'partial',
      startedAt,
      endedAt: checkedAt,
      actor,
      input: { slug: params.name, bundlePath: row.bundlePath },
      output: {
        previousStatus,
        newStatus: verdict.status,
        recordedDigest: row.recordedDigest,
        ...(verdict.observedDigest !== undefined ? { observedDigest: verdict.observedDigest } : {}),
        transitioned: previousStatus !== verdict.status,
      },
    });

    // Audit event (best-effort).
    if (opWrite.ok) {
      try {
        const auditEnsured = await ensureAuditCollection(fetch, pbToken);
        if (auditEnsured.ok) {
          let cellFingerprint = 'unknown';
          const identity = await getCellIdentity(fetch, pbToken);
          if (identity) cellFingerprint = identity.fingerprint;
          await writeAuditEvent(fetch, pbToken, {
            type: 'wp.spinner.integrity-checked',
            source: `urn:webspinner:cell:${cellFingerprint}`,
            subject: row.name,
            actor: operationActorToAuditActor(actor),
            result: verdict.status === 'verified' ? 'success' : 'error',
            reason:
              previousStatus === verdict.status
                ? `Re-check: ${verdict.status}`
                : `Transitioned ${previousStatus} → ${verdict.status}`,
            correlationId: opWrite.row.opId,
            ocsfClass: 6003,
            data: {
              spinnerName: row.name,
              slug: row.slug,
              bundlePath: row.bundlePath,
              previousStatus,
              newStatus: verdict.status,
              recordedDigest: row.recordedDigest,
              ...(verdict.observedDigest !== undefined
                ? { observedDigest: verdict.observedDigest }
                : {}),
              transitioned: previousStatus !== verdict.status,
            },
          });
        }
      } catch (err) {
        console.error(`[refreshIntegrity] audit write failed: ${(err as Error).message}`);
      }
    }

    return {
      success: true,
      newStatus: updated.row.integrityStatus,
      transitioned: previousStatus !== verdict.status,
      opId: opWrite.ok ? opWrite.row.opId : null,
    };
  },
};
