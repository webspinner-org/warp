/**
 * `wp_skein` — the Cell's Skein collection. One row per installed
 * Spinner, recording identity, location, recorded integrity, and
 * lifecycle. The substrate the `/admin/spinners` UI reads from to
 * display installation state + integrity status.
 *
 * Distinct from `spinners.ts`, which reads bundles from disk:
 *   - spinners.ts: "what manifests are on disk?"
 *   - skein.ts:    "what has this Cell installed + endorsed?"
 *
 * The two are joined in `/admin/spinners/+page.server.ts` by slug.
 * On a fresh Cell, the join finds disk bundles without skein rows
 * and auto-registers them as `genesis` (for ~/warp/spinners/*) or
 * `cell-authored` (for ~/Cells/spinners/*).
 *
 * Integrity checks reuse the existing `verifySpinnerBundle` op —
 * `refreshIntegrity` is the meta-runtime envelope that calls verify
 * and writes back the new status.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { SpinnerName } from '@webspinner-foundation/sdk';
// Auto-register helpers are declared below the main API.

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_skein';

export type SkeinSource =
  | 'genesis' // ~/warp/spinners/*
  | 'cell-authored' // ~/Cells/spinners/*, only signers = local Cell identity
  | 'foundation-recognized' // signed by Foundation release key
  | 'third-party'; // any other signing chain

export type IntegrityStatus =
  | 'verified'
  | 'unsigned'
  | 'digest-mismatch'
  | 'signature-invalid'
  | 'pending-install';

export interface SkeinSigner {
  readonly fingerprint: string;
  readonly signerLabel: 'cell-identity-key' | 'foundation-release-key';
  readonly signedAt: string;
}

export interface SkeinRow {
  readonly id: string;
  readonly name: SpinnerName;
  readonly slug: string;
  readonly version: string;
  readonly bundlePath: string;
  readonly source: SkeinSource;
  readonly sourceRepo?: string;
  readonly recordedDigest: string;
  readonly signers: readonly SkeinSigner[];
  readonly integrityStatus: IntegrityStatus;
  readonly lastIntegrityCheck: string;
  readonly installedAt: string;
  readonly installedBy: string;
  readonly installOpId?: string;
  readonly lastInvokedAt?: string;
  readonly invocationCount: number;
  /**
   * True when this row was produced by an Author-Spinner test run
   * (or any other ephemeral build-loop invocation). Demo rows are
   * hidden from the default Skein view, swept on a TTL, and don't
   * contribute to patron-facing counts. Authentic patron-installed
   * Spinners always have isDemo=false.
   */
  readonly isDemo: boolean;
}

export interface SkeinUpsert {
  readonly name: SpinnerName;
  readonly slug: string;
  readonly version: string;
  readonly bundlePath: string;
  readonly source: SkeinSource;
  readonly sourceRepo?: string;
  readonly recordedDigest: string;
  readonly signers: readonly SkeinSigner[];
  readonly integrityStatus: IntegrityStatus;
  readonly lastIntegrityCheck: string;
  readonly installedAt: string;
  readonly installedBy: string;
  readonly installOpId?: string;
  readonly isDemo?: boolean;
}

export interface ListSkeinRequest {
  readonly sources?: readonly SkeinSource[];
  readonly integrityStatuses?: readonly IntegrityStatus[];
  readonly limit?: number;
  readonly cursor?: string; // installedAt ISO of the last prev-page row
}

interface PBSkeinRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly version: string;
  readonly bundle_path: string;
  readonly source: string;
  readonly source_repo?: string;
  readonly recorded_digest: string;
  readonly signers: readonly SkeinSigner[] | null;
  readonly integrity_status: string;
  readonly last_integrity_check: string;
  readonly installed_at: string;
  readonly installed_by: string;
  readonly install_op_id?: string;
  readonly last_invoked_at?: string;
  readonly invocation_count?: number;
  readonly is_demo?: boolean;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

function parseRow(row: PBSkeinRow): SkeinRow {
  return {
    id: row.id,
    name: row.name as SpinnerName,
    slug: row.slug,
    version: row.version,
    bundlePath: row.bundle_path,
    source: row.source as SkeinSource,
    ...(row.source_repo && row.source_repo.length > 0 ? { sourceRepo: row.source_repo } : {}),
    recordedDigest: row.recorded_digest,
    signers: row.signers ?? [],
    integrityStatus: row.integrity_status as IntegrityStatus,
    lastIntegrityCheck: row.last_integrity_check,
    installedAt: row.installed_at,
    installedBy: row.installed_by,
    ...(row.install_op_id && row.install_op_id.length > 0
      ? { installOpId: row.install_op_id }
      : {}),
    ...(row.last_invoked_at && row.last_invoked_at.length > 0
      ? { lastInvokedAt: row.last_invoked_at }
      : {}),
    invocationCount: row.invocation_count ?? 0,
    isDemo: row.is_demo === true,
  };
}

export async function ensureSkeinCollection(
  fetchFn: typeof fetch,
  token: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const head = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}`, {
    headers: authHeaders(token),
  });
  if (head.ok) return { ok: true };
  if (head.status !== 404) return { ok: false, status: head.status, body: await head.text() };

  const create = await fetchFn(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'name', type: 'text', required: true, max: 128, presentable: true },
        {
          name: 'slug',
          type: 'text',
          required: true,
          unique: true,
          max: 128,
          presentable: true,
        },
        { name: 'version', type: 'text', required: true, max: 64 },
        { name: 'bundle_path', type: 'text', required: true, max: 512 },
        { name: 'source', type: 'text', required: true, max: 32 },
        { name: 'source_repo', type: 'text', required: false, max: 512 },
        { name: 'recorded_digest', type: 'text', required: true, max: 128 },
        { name: 'signers', type: 'json', required: false, maxSize: 16384 },
        { name: 'integrity_status', type: 'text', required: true, max: 32 },
        { name: 'last_integrity_check', type: 'text', required: true, max: 32 },
        { name: 'installed_at', type: 'text', required: true, max: 32 },
        { name: 'installed_by', type: 'text', required: true, max: 128 },
        { name: 'install_op_id', type: 'text', required: false, max: 64 },
        { name: 'last_invoked_at', type: 'text', required: false, max: 32 },
        { name: 'invocation_count', type: 'number', required: false },
        { name: 'is_demo', type: 'bool', required: false },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${COLLECTION}_slug ON ${COLLECTION} (slug)`,
        `CREATE INDEX idx_${COLLECTION}_source ON ${COLLECTION} (source)`,
        `CREATE INDEX idx_${COLLECTION}_integrity ON ${COLLECTION} (integrity_status)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

export async function listSkein(
  fetchFn: typeof fetch,
  token: string,
  req: ListSkeinRequest = {},
): Promise<
  | { ok: true; rows: readonly SkeinRow[]; nextCursor: string | null }
  | { ok: false; status: number; body: string }
> {
  const filters: string[] = [];
  if (req.sources && req.sources.length > 0) {
    filters.push(`(${req.sources.map((s) => `source = ${JSON.stringify(s)}`).join(' || ')})`);
  }
  if (req.integrityStatuses && req.integrityStatuses.length > 0) {
    filters.push(
      `(${req.integrityStatuses.map((s) => `integrity_status = ${JSON.stringify(s)}`).join(' || ')})`,
    );
  }
  if (req.cursor) {
    filters.push(`installed_at < ${JSON.stringify(req.cursor)}`);
  }
  const limit = Math.max(1, Math.min(200, req.limit ?? 100));
  const params = new URLSearchParams();
  params.set('perPage', String(limit));
  params.set('sort', '-installed_at');
  if (filters.length > 0) params.set('filter', filters.join(' && '));

  const res = await fetchFn(
    `${PB_URL}/api/collections/${COLLECTION}/records?${params.toString()}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as { items: readonly PBSkeinRow[] };
  const rows = body.items.map(parseRow);
  const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.installedAt ?? null) : null;
  return { ok: true, rows, nextCursor };
}

export async function getSkein(
  fetchFn: typeof fetch,
  token: string,
  slug: string,
): Promise<{ ok: true; row: SkeinRow | null } | { ok: false; status: number; body: string }> {
  const filter = `slug = ${JSON.stringify(slug)}`;
  const params = new URLSearchParams();
  params.set('perPage', '1');
  params.set('filter', filter);
  const res = await fetchFn(
    `${PB_URL}/api/collections/${COLLECTION}/records?${params.toString()}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as { items: readonly PBSkeinRow[] };
  const row = body.items[0];
  if (!row) return { ok: true, row: null };
  return { ok: true, row: parseRow(row) };
}

/**
 * Idempotent upsert keyed on slug. New row when slug doesn't exist;
 * PATCH otherwise.
 */
export async function upsertSkeinRow(
  fetchFn: typeof fetch,
  token: string,
  upsert: SkeinUpsert,
): Promise<{ ok: true; row: SkeinRow } | { ok: false; status: number; body: string }> {
  const existing = await getSkein(fetchFn, token, upsert.slug);
  if (!existing.ok) return existing;

  const payload = {
    name: upsert.name,
    slug: upsert.slug,
    version: upsert.version,
    bundle_path: upsert.bundlePath,
    source: upsert.source,
    source_repo: upsert.sourceRepo ?? '',
    recorded_digest: upsert.recordedDigest,
    signers: upsert.signers,
    integrity_status: upsert.integrityStatus,
    last_integrity_check: upsert.lastIntegrityCheck,
    installed_at: upsert.installedAt,
    installed_by: upsert.installedBy,
    install_op_id: upsert.installOpId ?? '',
    is_demo: upsert.isDemo === true,
  };

  if (existing.row) {
    // PATCH the existing row, preserving invocation counters.
    const res = await fetchFn(
      `${PB_URL}/api/collections/${COLLECTION}/records/${existing.row.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
    const body = (await res.json()) as PBSkeinRow;
    return { ok: true, row: parseRow(body) };
  }

  // Create new row.
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ ...payload, invocation_count: 0 }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as PBSkeinRow;
  return { ok: true, row: parseRow(body) };
}

/**
 * Update just the integrity status fields on an existing row. Used by
 * `refreshIntegrity` to record a fresh verification verdict without
 * touching install metadata.
 */
export async function updateIntegrityStatus(
  fetchFn: typeof fetch,
  token: string,
  slug: string,
  status: IntegrityStatus,
  checkedAt: string,
): Promise<{ ok: true; row: SkeinRow } | { ok: false; status: number; body: string }> {
  const existing = await getSkein(fetchFn, token, slug);
  if (!existing.ok) return existing;
  if (!existing.row) {
    return { ok: false, status: 404, body: `no skein row for slug "${slug}"` };
  }
  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records/${existing.row.id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({
      integrity_status: status,
      last_integrity_check: checkedAt,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as PBSkeinRow;
  return { ok: true, row: parseRow(body) };
}

export async function deleteSkeinRow(
  fetchFn: typeof fetch,
  token: string,
  slug: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const existing = await getSkein(fetchFn, token, slug);
  if (!existing.ok) return existing;
  if (!existing.row) return { ok: true }; // idempotent delete

  const res = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records/${existing.row.id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 404) {
    return { ok: false, status: res.status, body: await res.text() };
  }
  return { ok: true };
}

/**
 * Compute integrity for a bundle from scratch — used by auto-register
 * (no recorded digest to compare against; we record the computed one)
 * and by refreshIntegrity (compare recomputed to recorded).
 *
 * Pure delegation to the SDK: read manifest already done by caller,
 * digest computed via computeBundleDigest, provenance via readProvenance,
 * each signer verified via verifyBundleDigest. The caller decides what
 * to do with the verdict.
 */
import {
  computeBundleDigest,
  readProvenance,
  verifyBundleDigest,
  type SpinnerManifest,
} from '@webspinner-foundation/sdk';
import { nodeProvenanceIO } from './provenance-node.js';

export interface IntegrityVerdict {
  readonly status: IntegrityStatus;
  readonly observedDigest?: string;
  readonly signers: readonly SkeinSigner[];
}

export async function computeIntegrity(
  bundlePath: string,
  manifest: SpinnerManifest,
): Promise<IntegrityVerdict> {
  const io = nodeProvenanceIO(bundlePath);
  const digestResult = await computeBundleDigest(manifest, io.reader);
  if (!digestResult.ok) {
    return { status: 'pending-install', signers: [] };
  }
  const observedDigest = digestResult.value.digest;

  const provenance = await readProvenance(io.reader);
  if (provenance === null) {
    return { status: 'unsigned', observedDigest, signers: [] };
  }

  const signers: SkeinSigner[] = provenance.signersManifest.signers.map((s) => ({
    fingerprint: s.fingerprint,
    signerLabel: s.signer,
    signedAt: s.signedAt,
  }));

  if (provenance.signersManifest.digest !== observedDigest) {
    return { status: 'digest-mismatch', observedDigest, signers };
  }

  let allValid = true;
  for (const signer of provenance.signersManifest.signers) {
    const sig = provenance.signaturesBySigner[signer.fingerprint];
    if (!sig) {
      allValid = false;
      continue;
    }
    const v = verifyBundleDigest({
      digestRecord: provenance.digestRecord,
      signature: sig,
      publicKeyHex: signer.publicKeyHex,
    });
    if (!v.ok) {
      allValid = false;
    }
  }
  return {
    status: allValid ? 'verified' : 'signature-invalid',
    observedDigest,
    signers,
  };
}

/**
 * Classify a bundle's source by its disk path and signers. Called at
 * install time to populate the `source` field on the skein row.
 */
export function classifySource(
  bundlePath: string,
  signers: readonly SkeinSigner[],
  localCellFingerprint: string | null,
): SkeinSource {
  const abs = resolve(bundlePath);
  const warpRoot = resolve(homedir(), 'warp/spinners');
  const cellsRoot = resolve(homedir(), 'Cells/spinners');

  // Foundation-recognized takes precedence — if any signer is the
  // Foundation release key, that's the canonical classification.
  if (signers.some((s) => s.signerLabel === 'foundation-release-key')) {
    return 'foundation-recognized';
  }

  if (abs.startsWith(warpRoot + '/')) return 'genesis';

  if (abs.startsWith(cellsRoot + '/')) {
    // Cell-authored only if the local Cell identity is the sole signer.
    if (
      localCellFingerprint !== null &&
      signers.length > 0 &&
      signers.every((s) => s.fingerprint === localCellFingerprint)
    ) {
      return 'cell-authored';
    }
    // Otherwise it's third-party (signed by some other Cell, or unsigned).
    return 'third-party';
  }

  return 'third-party';
}
