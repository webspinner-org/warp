import { describe, test, expect } from 'vitest';
import {
  writeProvenance,
  readProvenance,
  verifyProvenance,
  type ProvenanceWriter,
} from './provenance.js';
import {
  computeBundleDigest,
  generateKeypair,
  signBundleDigest,
  type BundleReader,
  type SpinnerManifest,
  type SpinnerName,
} from './index.js';

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

interface MemoryFS {
  files: Map<string, Uint8Array>;
  reader: BundleReader;
  writer: ProvenanceWriter;
}

function memoryFS(seed: Record<string, Uint8Array> = {}): MemoryFS {
  const files = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(seed)) files.set(k, v);
  return {
    files,
    reader: {
      async readFile(path: string): Promise<Uint8Array | null> {
        const cleaned = path.replace(/^\.\//, '');
        return files.get(cleaned) ?? files.get(path) ?? null;
      },
    },
    writer: {
      async writeFile(path: string, content: string): Promise<void> {
        files.set(path, utf8(content));
      },
    },
  };
}

const baseManifest: SpinnerManifest = {
  manifestVersion: '1.0',
  name: '@test/example' as SpinnerName,
  displayName: 'Example',
  version: '1.0.0',
  description: 'A test Spinner used by the provenance suite.',
  license: 'Apache-2.0',
  entrypoint: './src/index.ts',
  vault: [],
  spools: [],
  env: [],
  dependsOn: [],
  capabilities: [],
  documentation: { howItWorks: 'how-it-works.md' },
  thumbnail: 'thumbnail.svg',
  threadable: true,
  audit: { source: 'urn:webspinner:cell:test/example' },
};

const baseFiles: Record<string, Uint8Array> = {
  'mission-lock.md': utf8('# Mission Lock\n'),
  'thumbnail.svg': utf8('<svg/>'),
  'how-it-works.md': utf8('# How it works\n'),
  './src/index.ts': utf8('export default () => "hi";\n'),
};

const fixedNow = (): Date => new Date('2026-05-12T17:00:00.000Z');

async function seedDigestAndSig() {
  const fs = memoryFS(baseFiles);
  const digestResult = await computeBundleDigest(baseManifest, fs.reader, fixedNow);
  if (!digestResult.ok) throw new Error(`digest failed: ${digestResult.error.kind}`);
  const kp = generateKeypair();
  const signature = signBundleDigest({
    digestRecord: digestResult.value,
    privateKeyHex: kp.privateKeyHex,
    publicKeyHex: kp.publicKeyHex,
    signer: 'cell-identity-key',
    now: fixedNow,
  });
  return { fs, digestRecord: digestResult.value, signature, kp };
}

describe('writeProvenance', () => {
  test('first-call writes the three expected files', async () => {
    const seed = await seedDigestAndSig();
    const result = await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.signersManifest.signers).toHaveLength(1);
    expect(result.signersManifest.signers[0]?.fingerprint).toBe(seed.kp.fingerprint);

    // Files written?
    const hex = seed.digestRecord.digest.split(':')[1];
    expect(seed.fs.files.has(`provenance/${hex}.json`)).toBe(true);
    expect(seed.fs.files.has(`provenance/${hex}.${seed.kp.fingerprint}.sig`)).toBe(true);
    expect(seed.fs.files.has('provenance/signers.json')).toBe(true);
  });

  test('signature file contains raw hex + LF, no JSON wrapper', async () => {
    const seed = await seedDigestAndSig();
    await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    const hex = seed.digestRecord.digest.split(':')[1];
    const sigBytes = seed.fs.files.get(`provenance/${hex}.${seed.kp.fingerprint}.sig`);
    expect(sigBytes).toBeDefined();
    if (!sigBytes) return;
    const text = new TextDecoder().decode(sigBytes);
    expect(text).toBe(seed.signature.signature + '\n');
  });

  test('idempotent: second call with same signer + same digest is a no-op', async () => {
    const seed = await seedDigestAndSig();
    const first = await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    const second = await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.signersManifest.signers).toHaveLength(1);
    }
  });

  test('merge: second call with same digest + new signer appends', async () => {
    const seed = await seedDigestAndSig();
    await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });

    // A second signer (the Foundation release key, simulated).
    const kp2 = generateKeypair();
    const sig2 = signBundleDigest({
      digestRecord: seed.digestRecord,
      privateKeyHex: kp2.privateKeyHex,
      publicKeyHex: kp2.publicKeyHex,
      signer: 'foundation-release-key',
      now: fixedNow,
    });
    const second = await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: sig2,
      publicKeyHex: kp2.publicKeyHex,
      signerLabel: 'foundation-release-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.signersManifest.signers).toHaveLength(2);
    const labels = second.signersManifest.signers.map((s) => s.signer).sort();
    expect(labels).toEqual(['cell-identity-key', 'foundation-release-key']);

    const hex = seed.digestRecord.digest.split(':')[1];
    expect(seed.fs.files.has(`provenance/${hex}.${seed.kp.fingerprint}.sig`)).toBe(true);
    expect(seed.fs.files.has(`provenance/${hex}.${kp2.fingerprint}.sig`)).toBe(true);
  });

  test('replace: call with a different digest replaces signers.json', async () => {
    const seed = await seedDigestAndSig();
    await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });

    // Mutate the bundle, compute a new digest, sign it. Provenance for the
    // old digest is now stale.
    const newFiles = { ...baseFiles, './src/index.ts': utf8('export default () => "bye";\n') };
    const newFs = memoryFS(newFiles);
    // Bring over the existing provenance so we can observe the "replace" path.
    for (const [k, v] of seed.fs.files.entries()) newFs.files.set(k, v);
    const newDigest = await computeBundleDigest(baseManifest, newFs.reader, fixedNow);
    expect(newDigest.ok).toBe(true);
    if (!newDigest.ok) return;

    const sigNew = signBundleDigest({
      digestRecord: newDigest.value,
      privateKeyHex: seed.kp.privateKeyHex,
      publicKeyHex: seed.kp.publicKeyHex,
      signer: 'cell-identity-key',
      now: fixedNow,
    });
    const result = await writeProvenance({
      digestRecord: newDigest.value,
      signature: sigNew,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: newFs.reader,
      writer: newFs.writer,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signersManifest.digest).toBe(newDigest.value.digest);
    expect(result.signersManifest.signers).toHaveLength(1);
  });

  test('malformed signers.json surfaces an error rather than crashing', async () => {
    const seed = await seedDigestAndSig();
    seed.fs.files.set('provenance/signers.json', utf8('{not json'));
    const result = await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('malformed-signers-json');
  });
});

describe('readProvenance', () => {
  test('returns null when no signers.json exists', async () => {
    const fs = memoryFS(baseFiles);
    expect(await readProvenance(fs.reader)).toBeNull();
  });

  test('round-trips every field written by writeProvenance', async () => {
    const seed = await seedDigestAndSig();
    await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    const back = await readProvenance(seed.fs.reader);
    expect(back).not.toBeNull();
    if (!back) return;
    expect(back.digestRecord.digest).toBe(seed.digestRecord.digest);
    expect(back.signersManifest.digest).toBe(seed.digestRecord.digest);
    expect(back.signersManifest.signers).toHaveLength(1);
    expect(back.signaturesBySigner[seed.kp.fingerprint]?.signature).toBe(seed.signature.signature);
  });
});

describe('verifyProvenance', () => {
  test('returns null when no signers.json exists', async () => {
    const fs = memoryFS(baseFiles);
    expect(await verifyProvenance(fs.reader)).toBeNull();
  });

  test('reports ok per signer when every signature verifies', async () => {
    const seed = await seedDigestAndSig();
    await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    const report = await verifyProvenance(seed.fs.reader);
    expect(report).not.toBeNull();
    if (!report) return;
    expect(report.signers).toHaveLength(1);
    expect(report.signers[0]?.result.ok).toBe(true);
  });

  test('reports signature-invalid when a .sig is tampered', async () => {
    const seed = await seedDigestAndSig();
    await writeProvenance({
      digestRecord: seed.digestRecord,
      signature: seed.signature,
      publicKeyHex: seed.kp.publicKeyHex,
      signerLabel: 'cell-identity-key',
      reader: seed.fs.reader,
      writer: seed.fs.writer,
    });
    // Flip one nibble in the .sig file.
    const hex = seed.digestRecord.digest.split(':')[1];
    const sigPath = `provenance/${hex}.${seed.kp.fingerprint}.sig`;
    const original = new TextDecoder().decode(seed.fs.files.get(sigPath) ?? new Uint8Array());
    const flipped = original.slice(0, 10) + (original[10] === 'a' ? 'b' : 'a') + original.slice(11);
    seed.fs.files.set(sigPath, utf8(flipped));

    const report = await verifyProvenance(seed.fs.reader);
    expect(report).not.toBeNull();
    if (!report) return;
    const first = report.signers[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.result.ok).toBe(false);
    if (!first.result.ok) {
      expect(first.result.reason).toBe('signature-invalid');
    }
  });
});
