import type { Brand } from './types.js';
import type { SpinnerManifest } from './manifest.js';

/**
 * SpinnerDigest — content-addressable hash of a Spinner's canonical bundle.
 *
 * Format: `<algorithm>:<lowercase-hex>`. Algorithm is `sha256` today; the
 * scheme is algorithmically-agile so the post-quantum migration can add
 * a parallel `sha3-512` digest without breaking the format.
 *
 * The bytes hashed are the *canonical bundle* — produced by the Loom's
 * server-side serializer per the recipe documented in `WARP-CANON.md` §19:
 *
 *   1. The manifest, JSON-stringified with sorted keys, no insignificant
 *      whitespace, terminated by a single LF.
 *   2. For each documentation file referenced by the manifest, in
 *      manifest-order: a SHA-256 hash of the file's UTF-8 bytes,
 *      hex-encoded, prefixed with the file's relative path and an LF.
 *   3. The entrypoint module's compiled bytes (post-build, deterministic).
 *
 * The Loom computes this digest on install and re-computes on every load.
 * A mismatch is a tampering signal: the load is gated and the Wizard sees
 * a warning. The full algorithm spec is open work
 * (`OPEN_QUESTIONS.md` — *Spinner integrity — canonical bundle digest*).
 */
export type SpinnerDigest = Brand<string, 'SpinnerDigest'>;

export type SpinnerSignatureAlgorithm = 'ed25519';

/**
 * SpinnerSignature — a signature over a SpinnerDigest.
 *
 * Signers identify themselves with a stable string — for first-party
 * Spinners, a key fingerprint of a Foundation release key; for
 * Cell-published Spinners, the publishing Cell's identity-key fingerprint.
 *
 * Signing scheme is open work; the type is shaped to support it.
 */
export interface SpinnerSignature {
  /** Stable identifier of the signer (key fingerprint). */
  readonly signer: string;
  readonly algorithm: SpinnerSignatureAlgorithm;
  /** Base64-encoded signature over the canonical digest string. */
  readonly signature: string;
  /** RFC 3339 timestamp. */
  readonly signedAt: string;
}

/**
 * IntegrityStatus — the result of verifying a Spinner's bundle on load.
 *
 * Reasons a load is gated:
 *  - `digest-mismatch`: the bundle on disk does not hash to the recorded
 *    digest. Tampering signal.
 *  - `signature-invalid`: a recorded signature does not verify against
 *    the digest under the signer's public key.
 *  - `unknown-signer`: a recorded signature names a signer the Cell does
 *    not have a public key for.
 *
 * `unsigned` is *not* a gate by default — it surfaces as a warning. The
 * Wizard's policy decides whether to invoke an unsigned Spinner. (Today,
 * the Bootstrap Spinner is unsigned; signing infrastructure is open work.)
 */
export type IntegrityStatus =
  | { readonly kind: 'verified'; readonly digest: SpinnerDigest; readonly signers: readonly string[] }
  | { readonly kind: 'unsigned'; readonly digest: SpinnerDigest }
  | { readonly kind: 'pending-install'; readonly observedDigest: SpinnerDigest }
  | {
      readonly kind: 'digest-mismatch';
      readonly recordedDigest: SpinnerDigest;
      readonly observedDigest: SpinnerDigest;
    }
  | { readonly kind: 'signature-invalid'; readonly signer: string }
  | { readonly kind: 'unknown-signer'; readonly signer: string };

/**
 * InstalledSpinner — the record persisted in the Grimoire when a Spinner
 * is installed into a Cell. Pairs the manifest with the digest and
 * signatures observed at install time, so subsequent loads can compare.
 */
export interface InstalledSpinner {
  readonly manifest: SpinnerManifest;
  readonly digest: SpinnerDigest;
  readonly signatures: readonly SpinnerSignature[];
  /** RFC 3339 timestamp of install. */
  readonly installedAt: string;
  /** Optional human note from the Wizard at install time. */
  readonly installNote?: string;
}

const DIGEST_RE = /^(sha256|sha3-512):[a-f0-9]+$/;

export function parseSpinnerDigest(input: string): SpinnerDigest | null {
  if (!DIGEST_RE.test(input)) return null;
  const [algo, hex] = input.split(':') as [string, string];
  if (algo === 'sha256' && hex.length !== 64) return null;
  if (algo === 'sha3-512' && hex.length !== 128) return null;
  return input as SpinnerDigest;
}

export function formatSpinnerDigest(algorithm: 'sha256' | 'sha3-512', hexLowercase: string): SpinnerDigest {
  const composed = `${algorithm}:${hexLowercase}`;
  const parsed = parseSpinnerDigest(composed);
  if (!parsed) {
    throw new Error(`Invalid digest components: algorithm=${algorithm}, hex length=${hexLowercase.length}`);
  }
  return parsed;
}
