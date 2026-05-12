/**
 * Canonical bundle digest for a Spinner.
 *
 * The digest is content-addressable. It hashes the bytes the Spinner
 * *promises* — its manifest, its operative mission-lock, its thumbnail, its
 * declared documentation, and its entrypoint — in a deterministic order.
 * Anything not declared by the manifest (working files in `src/`, tests,
 * authoring artifacts, provenance records, build output) is **not** in the
 * digest. The Spinner's contract is what it declares.
 *
 * Recipe (concatenated bytes, all UTF-8 unless noted):
 *
 *   1. `canonicalizeJSON(manifest)` (RFC 8785 JCS) followed by LF (0x0A).
 *   2. `mission-lock.md\n` followed by `sha256-hex(bytes(mission-lock.md))`
 *      followed by LF — if `<bundle>/mission-lock.md` exists.
 *   3. `<thumbnail-path>\n` followed by `sha256-hex(bytes(thumbnail))`
 *      followed by LF — `<thumbnail-path>` taken from `manifest.thumbnail`.
 *   4. For each documentation file referenced by the manifest, in order
 *      [howItWorks, readme?, examples?, ...additional[]]:
 *      `<doc-path>\n` followed by `sha256-hex(bytes(doc))` followed by LF.
 *   5. `entrypoint\n` followed by `sha256-hex(bytes(entrypoint))` followed
 *      by LF.
 *
 * The aggregate digest is `sha256` of the concatenated bytes above,
 * formatted as `sha256:<lowercase-hex>` (a `SpinnerDigest`).
 *
 * The full record returned by `computeBundleDigest` retains the per-file
 * hashes for forensic comparison when a digest mismatch occurs.
 *
 * Reading bundles from disk — `computeBundleDigest` accepts a `BundleReader`
 * interface so it stays platform-neutral. The Node implementation lives in
 * `digest-node.ts`; the browser / runner-instance implementation can hand in
 * a different reader.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import type { SpinnerDigest } from './integrity.js';
import { formatSpinnerDigest } from './integrity.js';
import type { SpinnerManifest } from './manifest.js';
import { canonicalizeJSON } from './canonical-json.js';

export interface BundleReader {
  /**
   * Returns the bytes of a file at the given path *relative to the bundle
   * root*. Returns `null` if the file does not exist. Throws on I/O
   * errors other than not-found.
   */
  readFile(relativePath: string): Promise<Uint8Array | null>;
}

export interface DocumentationDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface BundleDigestRecord {
  readonly schema: 'urn:webspinner:spinner-digest:v1.0.0';
  readonly algorithm: 'sha256';
  readonly digest: SpinnerDigest;
  readonly computedAt: string;
  readonly manifestCanonicalSha256: string;
  readonly missionLockSha256: string | null;
  readonly thumbnailSha256: string;
  readonly documentationSha256: readonly DocumentationDigest[];
  readonly entrypointSha256: string;
}

export type DigestComputeError =
  | { readonly kind: 'thumbnail-missing'; readonly path: string }
  | { readonly kind: 'documentation-missing'; readonly path: string }
  | { readonly kind: 'entrypoint-missing'; readonly path: string };

export type DigestComputeResult =
  | { readonly ok: true; readonly value: BundleDigestRecord }
  | { readonly ok: false; readonly error: DigestComputeError };

const LF = 0x0a;
const MISSION_LOCK_PATH = 'mission-lock.md';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function hashHex(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

function manifestDocPaths(manifest: SpinnerManifest): readonly string[] {
  const paths: string[] = [manifest.documentation.howItWorks];
  if (manifest.documentation.readme !== undefined) {
    paths.push(manifest.documentation.readme);
  }
  if (manifest.documentation.examples !== undefined) {
    paths.push(manifest.documentation.examples);
  }
  if (manifest.documentation.additional !== undefined) {
    for (const entry of manifest.documentation.additional) {
      paths.push(entry.path);
    }
  }
  return paths;
}

/**
 * Compute the canonical bundle digest for a Spinner. The manifest is taken
 * as already-parsed input — the caller is responsible for reading and
 * parsing it (since the manifest may need validation against ajv before
 * this step is reached).
 */
export async function computeBundleDigest(
  manifest: SpinnerManifest,
  reader: BundleReader,
  now: () => Date = () => new Date(),
): Promise<DigestComputeResult> {
  const parts: Uint8Array[] = [];

  // 1. Canonical manifest.
  const manifestCanonical = canonicalizeJSON(manifest);
  const manifestCanonicalBytes = utf8(manifestCanonical);
  const manifestCanonicalSha256 = hashHex(manifestCanonicalBytes);
  parts.push(manifestCanonicalBytes);
  parts.push(new Uint8Array([LF]));

  // 2. Mission lock (hard-coded path; optional but operative when present).
  const missionLockBytes = await reader.readFile(MISSION_LOCK_PATH);
  let missionLockSha256: string | null = null;
  if (missionLockBytes !== null) {
    missionLockSha256 = hashHex(missionLockBytes);
    parts.push(utf8(`${MISSION_LOCK_PATH}\n${missionLockSha256}\n`));
  }

  // 3. Thumbnail (required by manifest).
  const thumbnailBytes = await reader.readFile(manifest.thumbnail);
  if (thumbnailBytes === null) {
    return {
      ok: false,
      error: { kind: 'thumbnail-missing', path: manifest.thumbnail },
    };
  }
  const thumbnailSha256 = hashHex(thumbnailBytes);
  parts.push(utf8(`${manifest.thumbnail}\n${thumbnailSha256}\n`));

  // 4. Documentation (manifest-declared order).
  const docPaths = manifestDocPaths(manifest);
  const documentationSha256: DocumentationDigest[] = [];
  for (const path of docPaths) {
    const bytes = await reader.readFile(path);
    if (bytes === null) {
      return { ok: false, error: { kind: 'documentation-missing', path } };
    }
    const docHash = hashHex(bytes);
    documentationSha256.push({ path, sha256: docHash });
    parts.push(utf8(`${path}\n${docHash}\n`));
  }

  // 5. Entrypoint.
  const entrypointBytes = await reader.readFile(manifest.entrypoint);
  if (entrypointBytes === null) {
    return {
      ok: false,
      error: { kind: 'entrypoint-missing', path: manifest.entrypoint },
    };
  }
  const entrypointSha256 = hashHex(entrypointBytes);
  parts.push(utf8(`${manifest.entrypoint}\n${entrypointSha256}\n`));

  // Aggregate.
  const aggregateBytes = concat(parts);
  const aggregateHex = hashHex(aggregateBytes);

  return {
    ok: true,
    value: {
      schema: 'urn:webspinner:spinner-digest:v1.0.0',
      algorithm: 'sha256',
      digest: formatSpinnerDigest('sha256', aggregateHex),
      computedAt: now().toISOString(),
      manifestCanonicalSha256,
      missionLockSha256,
      thumbnailSha256,
      documentationSha256,
      entrypointSha256,
    },
  };
}
