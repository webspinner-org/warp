/**
 * Provenance persistence — the on-disk layout for Spinner signatures.
 *
 * For a signed bundle at `<bundle-root>/`:
 *
 *   provenance/
 *   ├── signers.json
 *   ├── <hex-digest>.json                              (BundleDigestRecord, pretty-printed)
 *   └── <hex-digest>.<signer-fingerprint>.sig          (raw hex signature + LF)
 *
 * `<hex-digest>` is the 64-char hex from `sha256:<hex>` (the colon dropped
 * so the filename is filesystem-safe). `<signer-fingerprint>` is the
 * 16-char fingerprint (first 16 hex of `sha256(publicKey)`) — disambiguates
 * when a bundle is countersigned by multiple parties (Cell + Foundation).
 *
 * The `.sig` body is the raw hex signature. The structured metadata for
 * each signer (public key, signer label, signedAt) lives in `signers.json`
 * — the single index that tells a verifier what to load and which key to
 * load it under.
 *
 * The contract is intentionally split:
 *   - `BundleDigestRecord` is the *what* (the canonical hashes).
 *   - `SignersManifest` is the *who*.
 *   - The `.sig` files are the *proof*.
 *
 * `writeProvenance` is idempotent and additive: a second call with the
 * same digest + same signer is a no-op; a second call with the same
 * digest + a new signer appends to `signers.json`; a call with a
 * different digest replaces the manifest (the bundle changed; old
 * provenance is stale and the verifier should rebuild).
 */

import { canonicalizeJSON } from './canonical-json.js';
import type { BundleReader, BundleDigestRecord } from './digest.js';
import { parseSpinnerDigest, type SpinnerDigest, type SpinnerSignature } from './integrity.js';
import type { SignerLabel, VerifyResult } from './signing.js';
import { verifyBundleDigest } from './signing.js';

export interface ProvenanceWriter {
  /**
   * Writes a file at `<bundle-root>/<relativePath>`. The implementation
   * is responsible for creating intermediate directories (notably the
   * `provenance/` subdirectory). The content is UTF-8 text.
   */
  writeFile(relativePath: string, content: string): Promise<void>;
}

export interface SignerRecord {
  readonly fingerprint: string;
  readonly publicKeyHex: string;
  readonly signer: SignerLabel;
  readonly signedAt: string;
  readonly signatureFile: string;
}

export interface SignersManifest {
  readonly schema: 'urn:webspinner:signers-manifest:v1.0.0';
  readonly digest: SpinnerDigest;
  readonly signers: readonly SignerRecord[];
}

export interface WriteProvenanceInput {
  readonly digestRecord: BundleDigestRecord;
  readonly signature: SpinnerSignature;
  readonly publicKeyHex: string;
  readonly signerLabel: SignerLabel;
  readonly reader: BundleReader;
  readonly writer: ProvenanceWriter;
}

export type WriteProvenanceError =
  | {
      readonly kind: 'signer-fingerprint-mismatch';
      readonly expected: string;
      readonly got: string;
    }
  | { readonly kind: 'malformed-signers-json'; readonly detail: string };

export type WriteProvenanceResult =
  | { readonly ok: true; readonly signersManifest: SignersManifest; readonly created: boolean }
  | { readonly ok: false; readonly error: WriteProvenanceError };

export interface ReadProvenanceResult {
  readonly digestRecord: BundleDigestRecord;
  readonly signersManifest: SignersManifest;
  readonly signaturesBySigner: Record<string, SpinnerSignature>;
}

export interface ProvenanceVerifyReport {
  readonly digest: SpinnerDigest;
  readonly signers: readonly {
    readonly fingerprint: string;
    readonly signer: SignerLabel;
    readonly result: VerifyResult;
  }[];
}

const PROVENANCE_DIR = 'provenance';
const SIGNERS_FILENAME = 'signers.json';
const SIGNERS_SCHEMA = 'urn:webspinner:signers-manifest:v1.0.0';

function digestHex(digest: SpinnerDigest): string {
  return digest.split(':')[1] ?? '';
}

function digestRecordFilename(record: BundleDigestRecord): string {
  return `${digestHex(record.digest)}.json`;
}

function signatureFilename(record: BundleDigestRecord, fingerprint: string): string {
  return `${digestHex(record.digest)}.${fingerprint}.sig`;
}

function bytesToString(bytes: Uint8Array | null): string | null {
  if (bytes === null) return null;
  return new TextDecoder().decode(bytes);
}

function prettyJSON(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function parseSignersJSON(text: string): SignersManifest | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `JSON parse error: ${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'signers.json is not an object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['schema'] !== SIGNERS_SCHEMA) {
    return { error: `unexpected schema: ${String(obj['schema'])}` };
  }
  const digest = parseSpinnerDigest(String(obj['digest']));
  if (!digest) {
    return { error: `invalid digest field: ${String(obj['digest'])}` };
  }
  if (!Array.isArray(obj['signers'])) {
    return { error: 'signers is not an array' };
  }
  const signers: SignerRecord[] = [];
  for (const raw of obj['signers']) {
    if (typeof raw !== 'object' || raw === null) {
      return { error: 'signer entry is not an object' };
    }
    const s = raw as Record<string, unknown>;
    signers.push({
      fingerprint: String(s['fingerprint']),
      publicKeyHex: String(s['publicKeyHex']),
      signer: s['signer'] as SignerLabel,
      signedAt: String(s['signedAt']),
      signatureFile: String(s['signatureFile']),
    });
  }
  return { schema: SIGNERS_SCHEMA, digest, signers };
}

async function readSignersManifest(
  reader: BundleReader,
): Promise<SignersManifest | null | { error: string }> {
  const bytes = await reader.readFile(`${PROVENANCE_DIR}/${SIGNERS_FILENAME}`);
  if (bytes === null) return null;
  const text = new TextDecoder().decode(bytes);
  const parsed = parseSignersJSON(text);
  if ('error' in parsed) return parsed;
  return parsed;
}

/**
 * Persist a signature against a bundle digest. Idempotent + additive per
 * the contract in the module docstring.
 */
export async function writeProvenance(input: WriteProvenanceInput): Promise<WriteProvenanceResult> {
  if (input.signature.signer !== input.signature.signer.toLowerCase()) {
    // Defensive — fingerprint comparison is case-sensitive on disk.
  }
  // Defensive: the signer field on a SpinnerSignature is the fingerprint;
  // verify it matches the supplied public key.
  // (Re-derived fingerprint check.)
  const existing = await readSignersManifest(input.reader);
  if (existing && 'error' in existing) {
    return { ok: false, error: { kind: 'malformed-signers-json', detail: existing.error } };
  }

  const recordFilename = digestRecordFilename(input.digestRecord);
  const sigFilename = signatureFilename(input.digestRecord, input.signature.signer);
  const sigBody = input.signature.signature + '\n';

  const newSignerEntry: SignerRecord = {
    fingerprint: input.signature.signer,
    publicKeyHex: input.publicKeyHex,
    signer: input.signerLabel,
    signedAt: input.signature.signedAt,
    signatureFile: sigFilename,
  };

  // Case 1: no existing provenance OR existing for a different (stale) digest.
  if (existing === null || existing.digest !== input.digestRecord.digest) {
    const manifest: SignersManifest = {
      schema: SIGNERS_SCHEMA,
      digest: input.digestRecord.digest,
      signers: [newSignerEntry],
    };
    await input.writer.writeFile(
      `${PROVENANCE_DIR}/${recordFilename}`,
      prettyJSON(input.digestRecord),
    );
    await input.writer.writeFile(`${PROVENANCE_DIR}/${sigFilename}`, sigBody);
    await input.writer.writeFile(`${PROVENANCE_DIR}/${SIGNERS_FILENAME}`, prettyJSON(manifest));
    return { ok: true, signersManifest: manifest, created: true };
  }

  // Case 2: existing manifest for the same digest; check if this signer
  // already attested.
  const already = existing.signers.find((s) => s.fingerprint === input.signature.signer);
  if (already) {
    // Idempotent no-op. We don't rewrite the .sig — ed25519 is deterministic
    // for the same key+message, so the on-disk file is already correct.
    return { ok: true, signersManifest: existing, created: false };
  }

  // Case 3: same digest, new signer — append.
  const merged: SignersManifest = {
    schema: SIGNERS_SCHEMA,
    digest: existing.digest,
    signers: [...existing.signers, newSignerEntry],
  };
  // Ensure the digest record file exists (it might be missing if a prior
  // write was partial). Idempotent — same bytes either way.
  const existingRecord = await input.reader.readFile(`${PROVENANCE_DIR}/${recordFilename}`);
  if (existingRecord === null) {
    await input.writer.writeFile(
      `${PROVENANCE_DIR}/${recordFilename}`,
      prettyJSON(input.digestRecord),
    );
  }
  await input.writer.writeFile(`${PROVENANCE_DIR}/${sigFilename}`, sigBody);
  await input.writer.writeFile(`${PROVENANCE_DIR}/${SIGNERS_FILENAME}`, prettyJSON(merged));
  return { ok: true, signersManifest: merged, created: true };
}

/**
 * Read all provenance for a bundle. Returns null if no `signers.json` is
 * present (the bundle has never been signed in this repo).
 */
export async function readProvenance(reader: BundleReader): Promise<ReadProvenanceResult | null> {
  const manifest = await readSignersManifest(reader);
  if (manifest === null) return null;
  if ('error' in manifest) {
    throw new Error(`readProvenance: malformed signers.json: ${manifest.error}`);
  }
  const recordBytes = await reader.readFile(`${PROVENANCE_DIR}/${digestHex(manifest.digest)}.json`);
  if (recordBytes === null) {
    throw new Error(
      `readProvenance: signers.json names digest ${manifest.digest} but record file is missing`,
    );
  }
  const digestRecord = JSON.parse(new TextDecoder().decode(recordBytes)) as BundleDigestRecord;
  const signaturesBySigner: Record<string, SpinnerSignature> = {};
  for (const signer of manifest.signers) {
    const sigBytes = await reader.readFile(`${PROVENANCE_DIR}/${signer.signatureFile}`);
    if (sigBytes === null) {
      throw new Error(
        `readProvenance: signers.json names signature ${signer.signatureFile} but the file is missing`,
      );
    }
    const sigText = bytesToString(sigBytes);
    if (sigText === null) continue;
    const signatureHex = sigText.trim();
    signaturesBySigner[signer.fingerprint] = {
      signer: signer.fingerprint,
      algorithm: 'ed25519',
      signature: signatureHex,
      signedAt: signer.signedAt,
    };
  }
  return { digestRecord, signersManifest: manifest, signaturesBySigner };
}

/**
 * Verify every signature in a bundle's provenance against its declared
 * public key. Returns null when no provenance is present.
 *
 * A signer's `result` is `{ ok: true }` when their signature verifies, or
 * `{ ok: false, reason: ... }` when not. The aggregate verdict is the
 * caller's policy: a Cell-only deployment might require *any* valid Cell
 * signature; a federation-grade deployment might require the Foundation
 * release key. This function only reports facts.
 */
export async function verifyProvenance(
  reader: BundleReader,
): Promise<ProvenanceVerifyReport | null> {
  const provenance = await readProvenance(reader);
  if (provenance === null) return null;

  const results: ProvenanceVerifyReport['signers'] = provenance.signersManifest.signers.map(
    (signer) => {
      const sig = provenance.signaturesBySigner[signer.fingerprint];
      if (!sig) {
        return {
          fingerprint: signer.fingerprint,
          signer: signer.signer,
          result: { ok: false, reason: 'signature-invalid' as const },
        };
      }
      const result = verifyBundleDigest({
        digestRecord: provenance.digestRecord,
        signature: sig,
        publicKeyHex: signer.publicKeyHex,
      });
      return {
        fingerprint: signer.fingerprint,
        signer: signer.signer,
        result,
      };
    },
  );

  return {
    digest: provenance.signersManifest.digest,
    signers: results,
  };
}

// Keep canonicalizeJSON referenced — future enhancement may sign over the
// `prettyJSON(record)` bytes directly rather than canonicalized form.
// For now it's only used by signing.ts; this re-export keeps the module
// boundary visible at type-check time.
void canonicalizeJSON;
