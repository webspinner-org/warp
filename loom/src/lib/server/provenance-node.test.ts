/**
 * Node-side E2E for the provenance persistence path: stand up a tmp
 * directory with Pablo's bundle, sign, write provenance, read it back,
 * verify, tamper, assert rejection.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, cp, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nodeProvenanceIO } from './provenance-node.js';
import {
  computeBundleDigest,
  generateKeypair,
  signBundleDigest,
  writeProvenance,
  readProvenance,
  verifyProvenance,
  type SpinnerManifest,
} from '@webspinner-foundation/sdk';

const PABLO_DIR = resolve(process.env['HOME'] ?? '~', 'warp/spinners/pablo');

async function pabloExists(): Promise<boolean> {
  try {
    const s = await stat(PABLO_DIR);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function stagePabloCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'warp-provenance-'));
  await cp(PABLO_DIR, dir, { recursive: true });
  return dir;
}

describe('provenance-node E2E — round-trip against a real Pablo bundle copy', async () => {
  const hasPablo = await pabloExists();

  it.skipIf(!hasPablo)('writes the three provenance files for a fresh sign', async () => {
    const dir = await stagePabloCopy();
    const io = nodeProvenanceIO(dir);
    const manifest = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    ) as SpinnerManifest;

    const digestResult = await computeBundleDigest(manifest, io.reader);
    expect(digestResult.ok).toBe(true);
    if (!digestResult.ok) return;

    const kp = generateKeypair();
    const sig = signBundleDigest({
      digestRecord: digestResult.value,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
    });
    const wrote = await writeProvenance({
      digestRecord: digestResult.value,
      signature: sig,
      publicKeyHex: kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: io.reader,
      writer: io.writer,
    });
    expect(wrote.ok).toBe(true);

    const provenanceDir = join(dir, 'provenance');
    const entries = await readdir(provenanceDir);
    const hex = digestResult.value.digest.split(':')[1] ?? '';
    expect(entries).toContain('signers.json');
    expect(entries).toContain(`${hex}.json`);
    expect(entries).toContain(`${hex}.${kp.fingerprint}.sig`);
  });

  it.skipIf(!hasPablo)('readProvenance + verifyProvenance round-trip', async () => {
    const dir = await stagePabloCopy();
    const io = nodeProvenanceIO(dir);
    const manifest = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    ) as SpinnerManifest;

    const digestResult = await computeBundleDigest(manifest, io.reader);
    if (!digestResult.ok) return;
    const kp = generateKeypair();
    const sig = signBundleDigest({
      digestRecord: digestResult.value,
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      signer: 'cell-identity-key',
    });
    await writeProvenance({
      digestRecord: digestResult.value,
      signature: sig,
      publicKeyHex: kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: io.reader,
      writer: io.writer,
    });

    const back = await readProvenance(io.reader);
    expect(back).not.toBeNull();
    if (!back) return;
    expect(back.digestRecord.digest).toBe(digestResult.value.digest);
    expect(back.signersManifest.signers).toHaveLength(1);

    const report = await verifyProvenance(io.reader);
    expect(report).not.toBeNull();
    if (!report) return;
    expect(report.signers).toHaveLength(1);
    expect(report.signers[0]?.result.ok).toBe(true);
  });

  it.skipIf(!hasPablo)(
    'tampering with the .sig file causes verifyProvenance to report signature-invalid',
    async () => {
      const dir = await stagePabloCopy();
      const io = nodeProvenanceIO(dir);
      const manifest = JSON.parse(
        await readFile(join(dir, 'manifest.json'), 'utf8'),
      ) as SpinnerManifest;

      const digestResult = await computeBundleDigest(manifest, io.reader);
      if (!digestResult.ok) return;
      const kp = generateKeypair();
      const sig = signBundleDigest({
        digestRecord: digestResult.value,
        privateKeyHex: kp.privateKeyHex,
        publicKeyHex: kp.publicKeyHex,
        signer: 'cell-identity-key',
      });
      await writeProvenance({
        digestRecord: digestResult.value,
        signature: sig,
        publicKeyHex: kp.publicKeyHex,
        signerLabel: 'cell-identity-key',
        reader: io.reader,
        writer: io.writer,
      });

      const hex = digestResult.value.digest.split(':')[1] ?? '';
      const sigPath = join(dir, 'provenance', `${hex}.${kp.fingerprint}.sig`);
      const original = await readFile(sigPath, 'utf8');
      // Flip one nibble at offset 12 to keep it valid hex.
      const ch = original[12] ?? 'a';
      const flipped = original.slice(0, 12) + (ch === 'b' ? 'c' : 'b') + original.slice(13);
      await writeFile(sigPath, flipped, 'utf8');

      const report = await verifyProvenance(io.reader);
      expect(report).not.toBeNull();
      if (!report) return;
      const first = report.signers[0];
      expect(first).toBeDefined();
      if (!first) return;
      expect(first.result.ok).toBe(false);
      if (!first.result.ok) {
        expect(first.result.reason).toBe('signature-invalid');
      }
    },
  );

  it.skipIf(!hasPablo)(
    'a second signer (foundation-release-key) is merged into signers.json',
    async () => {
      const dir = await stagePabloCopy();
      const io = nodeProvenanceIO(dir);
      const manifest = JSON.parse(
        await readFile(join(dir, 'manifest.json'), 'utf8'),
      ) as SpinnerManifest;

      const digestResult = await computeBundleDigest(manifest, io.reader);
      if (!digestResult.ok) return;

      const cellKp = generateKeypair();
      const cellSig = signBundleDigest({
        digestRecord: digestResult.value,
        privateKeyHex: cellKp.privateKeyHex,
        publicKeyHex: cellKp.publicKeyHex,
        signer: 'cell-identity-key',
      });
      await writeProvenance({
        digestRecord: digestResult.value,
        signature: cellSig,
        publicKeyHex: cellKp.publicKeyHex,
        signerLabel: 'cell-identity-key',
        reader: io.reader,
        writer: io.writer,
      });

      const foundationKp = generateKeypair();
      const foundationSig = signBundleDigest({
        digestRecord: digestResult.value,
        privateKeyHex: foundationKp.privateKeyHex,
        publicKeyHex: foundationKp.publicKeyHex,
        signer: 'foundation-release-key',
      });
      const merged = await writeProvenance({
        digestRecord: digestResult.value,
        signature: foundationSig,
        publicKeyHex: foundationKp.publicKeyHex,
        signerLabel: 'foundation-release-key',
        reader: io.reader,
        writer: io.writer,
      });
      expect(merged.ok).toBe(true);
      if (!merged.ok) return;
      expect(merged.signersManifest.signers).toHaveLength(2);

      const report = await verifyProvenance(io.reader);
      if (!report) return;
      expect(report.signers).toHaveLength(2);
      for (const s of report.signers) {
        expect(s.result.ok).toBe(true);
      }
    },
  );
});
