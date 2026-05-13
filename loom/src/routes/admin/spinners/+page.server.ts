import { listSpinners, type LoadedSpinner } from '$lib/server/spinners.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { getCellIdentity } from '$lib/server/identity.js';
import {
  ensureSkeinCollection,
  listSkein,
  upsertSkeinRow,
  computeIntegrity,
  classifySource,
  type SkeinRow,
  type IntegrityStatus,
  type SkeinSource,
} from '$lib/server/skein.js';
import type { PageServerLoad } from './$types.js';

interface SpinnerListRow {
  readonly slug: string;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly capabilityCount: number;
  readonly threadable: boolean;
  readonly integrityStatus: IntegrityStatus;
  readonly source: SkeinSource;
  readonly lastIntegrityCheck: string;
  readonly registered: boolean; // true when a wp_skein row exists
}

async function autoRegisterDiscovered(
  disk: LoadedSpinner,
  fetchFn: typeof fetch,
  token: string,
  cellFingerprint: string | null,
  now: string,
): Promise<SkeinRow | null> {
  const verdict = await computeIntegrity(disk.bundleDir, disk.manifest);
  const source = classifySource(disk.bundleDir, verdict.signers, cellFingerprint);
  const result = await upsertSkeinRow(fetchFn, token, {
    name: disk.manifest.name,
    slug: disk.slug,
    version: disk.manifest.version,
    bundlePath: disk.bundleDir,
    source,
    recordedDigest: verdict.observedDigest ?? `sha256:${'0'.repeat(64)}`,
    signers: verdict.signers,
    integrityStatus: verdict.status,
    lastIntegrityCheck: now,
    installedAt: now,
    installedBy: 'auto-register',
  });
  return result.ok ? result.row : null;
}

export const load: PageServerLoad = async ({ fetch }) => {
  const disk = await listSpinners();

  // Attempt the skein join. If the Loom can't reach PB (env, network),
  // fall back to disk-only — the page renders without the new
  // integrity badges, with a setupError surfaced.
  const pbToken = await loomPbToken(fetch);
  if (!pbToken) {
    return {
      spinners: disk.map<SpinnerListRow>((s) => ({
        slug: s.slug,
        name: s.manifest.name,
        displayName: s.manifest.displayName,
        version: s.manifest.version,
        description: s.manifest.description,
        capabilityCount: s.manifest.capabilities.length,
        threadable: s.manifest.threadable,
        integrityStatus: 'pending-install',
        source: 'genesis',
        lastIntegrityCheck: '',
        registered: false,
      })),
      setupError:
        'PocketBase superuser credentials missing on the Loom; Skein metadata cannot be read or written.',
    };
  }

  const ensured = await ensureSkeinCollection(fetch, pbToken);
  if (!ensured.ok) {
    return {
      spinners: disk.map<SpinnerListRow>((s) => ({
        slug: s.slug,
        name: s.manifest.name,
        displayName: s.manifest.displayName,
        version: s.manifest.version,
        description: s.manifest.description,
        capabilityCount: s.manifest.capabilities.length,
        threadable: s.manifest.threadable,
        integrityStatus: 'pending-install',
        source: 'genesis',
        lastIntegrityCheck: '',
        registered: false,
      })),
      setupError: `Failed to ensure wp_skein collection (HTTP ${ensured.status}): ${ensured.body.slice(0, 200)}`,
    };
  }

  // First-pass list — what's already in the Skein.
  const initialList = await listSkein(fetch, pbToken, { limit: 200 });
  let skeinBySlug = new Map<string, SkeinRow>();
  if (initialList.ok) {
    for (const r of initialList.rows) skeinBySlug.set(r.slug, r);
  }

  // Cell fingerprint (best-effort) for source classification.
  let cellFingerprint: string | null = null;
  try {
    const identity = await getCellIdentity(fetch, pbToken);
    if (identity) cellFingerprint = identity.fingerprint;
  } catch {
    // not provisioned yet — pass null; cell-authored bundles will
    // classify as third-party until identity exists
  }

  // Auto-register any disk-discovered Spinner without a skein row.
  const now = new Date().toISOString();
  let migrated = 0;
  for (const s of disk) {
    if (skeinBySlug.has(s.slug)) continue;
    const row = await autoRegisterDiscovered(s, fetch, pbToken, cellFingerprint, now);
    if (row) {
      skeinBySlug.set(row.slug, row);
      migrated++;
    }
  }

  // If we registered anything, the initial list is stale — re-read.
  if (migrated > 0) {
    const refresh = await listSkein(fetch, pbToken, { limit: 200 });
    if (refresh.ok) {
      skeinBySlug = new Map();
      for (const r of refresh.rows) skeinBySlug.set(r.slug, r);
    }
  }

  // Merge disk + skein.
  const spinners: SpinnerListRow[] = disk.map((s) => {
    const row = skeinBySlug.get(s.slug);
    if (row) {
      return {
        slug: s.slug,
        name: s.manifest.name,
        displayName: s.manifest.displayName,
        version: s.manifest.version,
        description: s.manifest.description,
        capabilityCount: s.manifest.capabilities.length,
        threadable: s.manifest.threadable,
        integrityStatus: row.integrityStatus,
        source: row.source,
        lastIntegrityCheck: row.lastIntegrityCheck,
        registered: true,
      };
    }
    // Disk-discovered but auto-register failed; render as unregistered.
    return {
      slug: s.slug,
      name: s.manifest.name,
      displayName: s.manifest.displayName,
      version: s.manifest.version,
      description: s.manifest.description,
      capabilityCount: s.manifest.capabilities.length,
      threadable: s.manifest.threadable,
      integrityStatus: 'pending-install',
      source: 'genesis',
      lastIntegrityCheck: '',
      registered: false,
    };
  });

  return { spinners };
};
