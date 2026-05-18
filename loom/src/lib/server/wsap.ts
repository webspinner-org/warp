/**
 * Webspinner Application Package (`.wsap`) — patron-built app
 * portability format. v0.1 per ~/warp/APP-PORTABILITY.md.
 *
 * A `.wsap` bundle is a single signed JSON object that a Webspinner
 * exports from their Cell and another Webspinner can install in
 * theirs. Schema + UX + provenance + ed25519 signature; no data in
 * v0.1.
 *
 * Server-side primitives:
 *   - buildWsapBundle(opts)  — construct an unsigned bundle
 *   - signWsapBundle(...)    — attach an ed25519 signature using a Cell keypair
 *   - verifyWsapBundle(...)  — confirm a bundle's signature
 *
 * The signature covers the canonicalised JSON of the bundle WITHOUT
 * its own `signature` field — same scheme as the existing Spinner
 * bundle digest signatures (canonicalizeJSON + ed25519), just over
 * a different envelope.
 */

import {
  canonicalizeJSON,
  fingerprintOf,
  signBytes,
  verifyBytes,
} from '@webspinner-foundation/sdk';

/**
 * Current format string. New bundles write this. Verifiers also
 * accept the legacy `wsap/v0.1` for back-compat with bundles
 * already published before the rename.
 */
export const WSAP_FORMAT = 'webbase/v0.1' as const;
export const WSAP_FORMAT_LEGACY = 'wsap/v0.1' as const;
const ACCEPTED_FORMATS = new Set<string>([WSAP_FORMAT, WSAP_FORMAT_LEGACY]);

export type WsapBundleKind = 'database-application';

export interface WsapCreatedBy {
  readonly cellName: string;
  readonly cellKeyFingerprint: string;
  /** Hex-encoded ed25519 public key. Self-attesting: the bundle
   * carries its own verification key. Receiving Cells decide trust
   * out-of-band (the patron recognising the fingerprint, etc.). */
  readonly cellPublicKeyHex: string;
  readonly displayName?: string;
}

export interface WsapCreatedFrom {
  readonly patronSentence: string;
  readonly spinnerBundleName: string;
  readonly spinnerBundleVersion: string;
  readonly spinnerBundleDigest?: string;
  readonly createdAt: string;
  readonly originAppId?: string;
}

export interface WsapDesign {
  readonly screensDraft: unknown;
  readonly branding: unknown;
}

export interface WsapSchemaEntity {
  readonly name: string;
  readonly describes?: string;
  readonly fields: readonly {
    readonly name: string;
    readonly kind: string;
    readonly describes?: string;
  }[];
  readonly links: readonly {
    readonly to: string;
    readonly describes?: string;
  }[];
}

export interface WsapSchema {
  readonly screensDraftVersion: number;
  readonly entities: readonly WsapSchemaEntity[];
}

export interface WsapSignature {
  readonly alg: 'ed25519';
  readonly keyFingerprint: string;
  readonly value: string; // hex-encoded signature bytes
}

export interface WsapBundle {
  readonly format: typeof WSAP_FORMAT | typeof WSAP_FORMAT_LEGACY;
  readonly kind: WsapBundleKind;
  readonly createdBy: WsapCreatedBy;
  readonly createdFrom: WsapCreatedFrom;
  readonly design: WsapDesign;
  readonly schema: WsapSchema;
  readonly data: null; // v0.1: always null
  readonly signature: WsapSignature;
}

export type WsapBundleUnsigned = Omit<WsapBundle, 'signature'>;

export interface BuildBundleInput {
  readonly kind: WsapBundleKind;
  readonly createdBy: WsapCreatedBy;
  readonly createdFrom: WsapCreatedFrom;
  readonly design: WsapDesign;
  readonly schema: WsapSchema;
}

/**
 * Construct an unsigned bundle from inputs. Call signWsapBundle next.
 */
export function buildWsapBundle(input: BuildBundleInput): WsapBundleUnsigned {
  return {
    format: WSAP_FORMAT,
    kind: input.kind,
    createdBy: input.createdBy,
    createdFrom: input.createdFrom,
    design: input.design,
    schema: input.schema,
    data: null,
  };
}

export interface SignWsapInput {
  readonly bundle: WsapBundleUnsigned;
  readonly privateKeyHex: string;
  readonly publicKeyHex: string;
}

/**
 * Sign an unsigned bundle with the Cell's keypair. Returns the
 * canonicalised string + the attached signature.
 */
export function signWsapBundle(input: SignWsapInput): WsapBundle {
  const canonical = canonicalizeJSON(input.bundle);
  const message = new TextEncoder().encode(canonical);
  const sigHex = signBytes(message, input.privateKeyHex);
  const fp = fingerprintOf(input.publicKeyHex);
  return {
    ...input.bundle,
    signature: {
      alg: 'ed25519',
      keyFingerprint: fp,
      value: sigHex,
    },
  };
}

export type WsapVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: WsapVerifyError };

export type WsapVerifyError =
  | 'format-unsupported'
  | 'kind-unsupported'
  | 'signature-missing'
  | 'signature-malformed'
  | 'fingerprint-mismatch'
  | 'signature-invalid';

export interface VerifyWsapInput {
  readonly bundle: unknown;
}

/**
 * Verify a `.wsap` bundle. Self-attesting: reads the public key
 * out of `bundle.createdBy.cellPublicKeyHex` and confirms (a) the
 * fingerprint in the signature matches the public key, and (b) the
 * signature is valid over the canonicalised JSON of the bundle
 * (excluding the signature field). Trust in the public key itself
 * is out-of-band (the patron recognising the fingerprint they
 * expected from a known sender).
 */
export function verifyWsapBundle(input: VerifyWsapInput): WsapVerifyResult {
  if (typeof input.bundle !== 'object' || input.bundle === null) {
    return { ok: false, reason: 'format-unsupported' };
  }
  const b = input.bundle as Record<string, unknown>;
  if (typeof b['format'] !== 'string' || !ACCEPTED_FORMATS.has(b['format'] as string)) {
    return { ok: false, reason: 'format-unsupported' };
  }
  if (b['kind'] !== 'database-application') return { ok: false, reason: 'kind-unsupported' };
  if (typeof b['signature'] !== 'object' || b['signature'] === null) {
    return { ok: false, reason: 'signature-missing' };
  }
  const sig = b['signature'] as Record<string, unknown>;
  if (sig['alg'] !== 'ed25519' || typeof sig['value'] !== 'string') {
    return { ok: false, reason: 'signature-malformed' };
  }
  const createdBy = b['createdBy'] as Record<string, unknown> | undefined;
  if (!createdBy || typeof createdBy['cellPublicKeyHex'] !== 'string') {
    return { ok: false, reason: 'signature-malformed' };
  }
  const publicKeyHex = createdBy['cellPublicKeyHex'] as string;
  const expectedFp = fingerprintOf(publicKeyHex);
  if (sig['keyFingerprint'] !== expectedFp) {
    return { ok: false, reason: 'fingerprint-mismatch' };
  }
  // Strip signature; canonicalize the rest; verify.
  const unsigned: Record<string, unknown> = { ...b };
  delete unsigned['signature'];
  const canonical = canonicalizeJSON(unsigned);
  const message = new TextEncoder().encode(canonical);
  const ok = verifyBytes(message, sig['value'] as string, publicKeyHex);
  return ok ? { ok: true } : { ok: false, reason: 'signature-invalid' };
}
