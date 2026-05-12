/**
 * End-to-end signing smoke test against the real Pablo Spinner bundle.
 *
 * Reads ~/warp/spinners/pablo from disk, computes the canonical digest,
 * generates a fresh ed25519 keypair, signs the digest, verifies, mutates,
 * asserts rejection. Tests run skipped when the Pablo directory does not
 * exist (so the suite passes on a fresh clone before bundles land).
 */

import { describe, it, expect } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  computeBundleDigest,
  generateKeypair,
  signBundleDigest,
  verifyBundleDigest,
  type BundleReader,
  type SpinnerManifest,
} from '@webspinner-foundation/sdk';

const PABLO_DIR = resolve(process.env['HOME'] ?? '~', 'warp/spinners/pablo');

function nodeReader(bundleRoot: string): BundleReader {
  return {
    async readFile(relativePath: string): Promise<Uint8Array | null> {
      // The manifest may carry `./` prefixes; normalize so they resolve to
      // the same path on disk as the bare form.
      const cleaned = relativePath.replace(/^\.\//, '');
      const full = join(bundleRoot, cleaned);
      try {
        return new Uint8Array(await readFile(full));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
  };
}

async function pabloExists(): Promise<boolean> {
  try {
    const s = await stat(PABLO_DIR);
    return s.isDirectory();
  } catch {
    return false;
  }
}

describe('signing smoke — real Pablo bundle', async () => {
  const hasPablo = await pabloExists();

  it.skipIf(!hasPablo)('computes a deterministic digest against the on-disk bundle', async () => {
    const manifest = JSON.parse(
      await readFile(join(PABLO_DIR, 'manifest.json'), 'utf8'),
    ) as SpinnerManifest;
    const r1 = await computeBundleDigest(
      manifest,
      nodeReader(PABLO_DIR),
      () => new Date('2026-05-12T17:00:00.000Z'),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = await computeBundleDigest(
      manifest,
      nodeReader(PABLO_DIR),
      () => new Date('2026-05-12T17:00:00.000Z'),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r1.value.digest).toBe(r2.value.digest);
    expect(r1.value.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    // The fixed timestamp produces a fully deterministic record, so we
    // can print a stable digest for the smoke output:

    console.log('  Pablo digest:', r1.value.digest);
  });

  it.skipIf(!hasPablo)('signs the digest with a fresh keypair and verifies', async () => {
    const manifest = JSON.parse(
      await readFile(join(PABLO_DIR, 'manifest.json'), 'utf8'),
    ) as SpinnerManifest;
    const result = await computeBundleDigest(manifest, nodeReader(PABLO_DIR));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const kp = generateKeypair();
    const sig = signBundleDigest({
      digestRecord: result.value,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
    });
    expect(sig.signer).toBe(kp.fingerprint);

    console.log('  Pablo signed by fingerprint:', kp.fingerprint);

    const ok = verifyBundleDigest({
      digestRecord: result.value,
      signature: sig,
      publicKeyHex: kp.publicKeyHex,
    });
    expect(ok.ok).toBe(true);
  });

  it.skipIf(!hasPablo)('mutating the manifest changes the digest', async () => {
    const manifest = JSON.parse(
      await readFile(join(PABLO_DIR, 'manifest.json'), 'utf8'),
    ) as SpinnerManifest;
    const r1 = await computeBundleDigest(manifest, nodeReader(PABLO_DIR));
    const mutated: SpinnerManifest = {
      ...manifest,
      description: manifest.description + ' (mutated)',
    };
    const r2 = await computeBundleDigest(mutated, nodeReader(PABLO_DIR));
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.digest).not.toBe(r2.value.digest);
    }
  });

  it.skipIf(!hasPablo)('a signature over one digest record rejects a tampered record', async () => {
    const manifest = JSON.parse(
      await readFile(join(PABLO_DIR, 'manifest.json'), 'utf8'),
    ) as SpinnerManifest;
    const result = await computeBundleDigest(manifest, nodeReader(PABLO_DIR));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const kp = generateKeypair();
    const sig = signBundleDigest({
      digestRecord: result.value,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
    });

    // Tamper: replace the entrypoint hash with a different value.
    const tampered = { ...result.value, entrypointSha256: '0'.repeat(64) };
    const verify = verifyBundleDigest({
      digestRecord: tampered,
      signature: sig,
      publicKeyHex: kp.publicKeyHex,
    });
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.reason).toBe('signature-invalid');
  });
});
