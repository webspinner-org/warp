/**
 * ed25519 sign + verify primitives, used by the Loom to sign Spinner
 * bundle digests with the Cell's identity key, and by the Weaver to verify
 * recorded signatures against known signer public keys.
 *
 * The byte sequence signed is the canonical-JSON serialization of the
 * `BundleDigestRecord` (RFC 8785 JCS, UTF-8, no trailing LF). That is the
 * "message" in ed25519's terms — what the signature commits to. Both
 * signer and verifier reproduce the same canonical bytes; if the digest
 * record's contents differ at all, the signature fails to verify.
 *
 * Keys, signatures, fingerprints — all hex-encoded for storage. The hex
 * format is the on-disk wire form; in-memory we use Uint8Array.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalizeJSON } from './canonical-json.js';
import type { BundleDigestRecord } from './digest.js';
import type { SpinnerSignature } from './integrity.js';

export interface Ed25519Keypair {
  /** 32-byte private (secret) key, lowercase hex (64 chars). */
  readonly privateKeyHex: string;
  /** 32-byte public key, lowercase hex (64 chars). */
  readonly publicKeyHex: string;
  /**
   * Fingerprint = first 16 hex chars of sha256(publicKey). Used in
   * filenames, audit events, and the `SpinnerSignature.signer` field. Short
   * enough to be human-quotable; long enough to disambiguate.
   */
  readonly fingerprint: string;
}

export type SignerLabel = 'cell-identity-key' | 'foundation-release-key';

export interface SignBundleDigestInput {
  readonly digestRecord: BundleDigestRecord;
  readonly privateKeyHex: string;
  readonly publicKeyHex: string;
  readonly signer: SignerLabel;
  readonly now?: () => Date;
}

export interface VerifyBundleDigestInput {
  readonly digestRecord: BundleDigestRecord;
  readonly signature: SpinnerSignature;
  readonly publicKeyHex: string;
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'signature-invalid' | 'algorithm-unsupported' };

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length input (${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes: invalid hex at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

export function generateKeypair(): Ed25519Keypair {
  const { secretKey, publicKey } = ed25519.keygen();
  return keypairFromBytes(secretKey, publicKey);
}

export function keypairFromPrivateHex(privateKeyHex: string): Ed25519Keypair {
  const secret = hexToBytes(privateKeyHex);
  if (secret.length !== 32) {
    throw new Error(`keypairFromPrivateHex: private key must be 32 bytes; got ${secret.length}`);
  }
  const publicKey = ed25519.getPublicKey(secret);
  return keypairFromBytes(secret, publicKey);
}

function keypairFromBytes(secretKey: Uint8Array, publicKey: Uint8Array): Ed25519Keypair {
  const publicKeyHex = bytesToHex(publicKey);
  const fingerprint = bytesToHex(sha256(publicKey)).slice(0, 16);
  return {
    privateKeyHex: bytesToHex(secretKey),
    publicKeyHex,
    fingerprint,
  };
}

export function fingerprintOf(publicKeyHex: string): string {
  const pub = hexToBytes(publicKeyHex);
  return bytesToHex(sha256(pub)).slice(0, 16);
}

function canonicalDigestBytes(record: BundleDigestRecord): Uint8Array {
  // Strip the volatile `computedAt` field from the message? No — we want
  // the signature to commit to the full record including timestamp.
  // A second run produces a different `computedAt` and therefore a
  // different signature, which is correct: a re-sign event is a real
  // event that should be re-recorded.
  return new TextEncoder().encode(canonicalizeJSON(record));
}

/**
 * Sign arbitrary bytes with an Ed25519 secret key. Returns the
 * signature as a hex string. Used for non-Spinner artifacts (e.g.
 * Webspinner Application Packages — .wsap) that need the same
 * ceremony but a different envelope.
 */
export function signBytes(message: Uint8Array, privateKeyHex: string): string {
  const secret = hexToBytes(privateKeyHex);
  const sig = ed25519.sign(message, secret);
  return bytesToHex(sig);
}

/**
 * Verify an Ed25519 hex signature over arbitrary bytes.
 */
export function verifyBytes(
  message: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  return ed25519.verify(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex));
}

export function signBundleDigest(input: SignBundleDigestInput): SpinnerSignature {
  const message = canonicalDigestBytes(input.digestRecord);
  const secret = hexToBytes(input.privateKeyHex);
  const sigBytes = ed25519.sign(message, secret);
  const fingerprint = fingerprintOf(input.publicKeyHex);
  const signedAt = (input.now ?? (() => new Date()))().toISOString();
  return {
    signer: fingerprint,
    algorithm: 'ed25519',
    signature: bytesToHex(sigBytes),
    signedAt,
  };
}

export function verifyBundleDigest(input: VerifyBundleDigestInput): VerifyResult {
  if (input.signature.algorithm !== 'ed25519') {
    return { ok: false, reason: 'algorithm-unsupported' };
  }
  const message = canonicalDigestBytes(input.digestRecord);
  const sig = hexToBytes(input.signature.signature);
  const pub = hexToBytes(input.publicKeyHex);
  const valid = ed25519.verify(sig, message, pub);
  return valid ? { ok: true } : { ok: false, reason: 'signature-invalid' };
}
