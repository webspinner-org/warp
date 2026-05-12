import { describe, test, expect } from 'vitest';
import {
  generateKeypair,
  keypairFromPrivateHex,
  fingerprintOf,
  signBundleDigest,
  verifyBundleDigest,
} from './signing.js';
import type { BundleDigestRecord } from './digest.js';
import { formatSpinnerDigest } from './integrity.js';

const fixedNow = (): Date => new Date('2026-05-12T17:00:00.000Z');

function fixtureRecord(): BundleDigestRecord {
  return {
    schema: 'urn:webspinner:spinner-digest:v1.0.0',
    algorithm: 'sha256',
    digest: formatSpinnerDigest('sha256', 'a'.repeat(64)),
    computedAt: '2026-05-12T17:00:00.000Z',
    manifestCanonicalSha256: 'b'.repeat(64),
    missionLockSha256: 'c'.repeat(64),
    thumbnailSha256: 'd'.repeat(64),
    documentationSha256: [{ path: 'how-it-works.md', sha256: 'e'.repeat(64) }],
    entrypointSha256: 'f'.repeat(64),
  };
}

describe('keypair generation', () => {
  test('generates a keypair with hex-encoded keys and 16-char fingerprint', () => {
    const kp = generateKeypair();
    expect(kp.privateKeyHex).toMatch(/^[a-f0-9]{64}$/);
    expect(kp.publicKeyHex).toMatch(/^[a-f0-9]{64}$/);
    expect(kp.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  test('two keypairs are distinct', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(a.privateKeyHex).not.toBe(b.privateKeyHex);
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  test('keypairFromPrivateHex round-trips: given private, recovers same public + fingerprint', () => {
    const original = generateKeypair();
    const recovered = keypairFromPrivateHex(original.privateKeyHex);
    expect(recovered.publicKeyHex).toBe(original.publicKeyHex);
    expect(recovered.fingerprint).toBe(original.fingerprint);
  });

  test('fingerprintOf(publicKey) matches the keypair fingerprint', () => {
    const kp = generateKeypair();
    expect(fingerprintOf(kp.publicKeyHex)).toBe(kp.fingerprint);
  });

  test('keypairFromPrivateHex rejects wrong-length input', () => {
    expect(() => keypairFromPrivateHex('ab')).toThrow();
    expect(() => keypairFromPrivateHex('a'.repeat(62))).toThrow();
  });
});

describe('signBundleDigest + verifyBundleDigest', () => {
  test('sign then verify under the same key — valid', () => {
    const kp = generateKeypair();
    const record = fixtureRecord();
    const sig = signBundleDigest({
      digestRecord: record,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
      now: fixedNow,
    });
    expect(sig.algorithm).toBe('ed25519');
    expect(sig.signer).toBe(kp.fingerprint);
    expect(sig.signature).toMatch(/^[a-f0-9]{128}$/);
    expect(sig.signedAt).toBe('2026-05-12T17:00:00.000Z');

    const verified = verifyBundleDigest({
      digestRecord: record,
      signature: sig,
      publicKeyHex: kp.publicKeyHex,
    });
    expect(verified.ok).toBe(true);
  });

  test('mutated signature → rejected', () => {
    const kp = generateKeypair();
    const record = fixtureRecord();
    const sig = signBundleDigest({
      digestRecord: record,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
      now: fixedNow,
    });
    // Flip one nibble in the middle of the signature.
    const flipped = sig.signature.slice(0, 60) + 'f' + sig.signature.slice(61);
    const verified = verifyBundleDigest({
      digestRecord: record,
      signature: { ...sig, signature: flipped },
      publicKeyHex: kp.publicKeyHex,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('signature-invalid');
  });

  test('mutated digest record → rejected', () => {
    const kp = generateKeypair();
    const record = fixtureRecord();
    const sig = signBundleDigest({
      digestRecord: record,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
      now: fixedNow,
    });
    const mutated: BundleDigestRecord = {
      ...record,
      entrypointSha256: '0'.repeat(64),
    };
    const verified = verifyBundleDigest({
      digestRecord: mutated,
      signature: sig,
      publicKeyHex: kp.publicKeyHex,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('signature-invalid');
  });

  test('signed by A, verified with B — rejected', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const record = fixtureRecord();
    const sig = signBundleDigest({
      digestRecord: record,
      privateKeyHex: a.privateKeyHex,
      publicKeyHex: a.publicKeyHex,
      signer: 'cell-identity-key',
      now: fixedNow,
    });
    const verified = verifyBundleDigest({
      digestRecord: record,
      signature: sig,
      publicKeyHex: b.publicKeyHex,
    });
    expect(verified.ok).toBe(false);
  });

  test('unsupported signature algorithm → rejected with algorithm-unsupported', () => {
    const kp = generateKeypair();
    const record = fixtureRecord();
    const verified = verifyBundleDigest({
      digestRecord: record,
      signature: {
        signer: kp.fingerprint,
        algorithm: 'rsa-pss' as unknown as 'ed25519',
        signature: 'a'.repeat(128),
        signedAt: '2026-05-12T17:00:00.000Z',
      },
      publicKeyHex: kp.publicKeyHex,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('algorithm-unsupported');
  });

  test('signature is reproducible for fixed inputs (same key, same record, same time)', () => {
    const kp = keypairFromPrivateHex('1'.repeat(64));
    const record = fixtureRecord();
    const a = signBundleDigest({
      digestRecord: record,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
      now: fixedNow,
    });
    const b = signBundleDigest({
      digestRecord: record,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
      now: fixedNow,
    });
    // ed25519 is deterministic — signing the same message with the same
    // key produces the same signature.
    expect(a.signature).toBe(b.signature);
  });
});
