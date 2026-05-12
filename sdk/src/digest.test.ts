import { describe, test, expect } from 'vitest';
import type { SpinnerManifest, SpinnerName } from './manifest.js';
import { computeBundleDigest, type BundleReader, type BundleDigestRecord } from './digest.js';

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function mockReader(files: Record<string, Uint8Array | null>): BundleReader {
  return {
    async readFile(path: string): Promise<Uint8Array | null> {
      const found = files[path];
      return found ?? null;
    },
  };
}

const baseManifest: SpinnerManifest = {
  manifestVersion: '1.0',
  name: '@test/example' as SpinnerName,
  displayName: 'Example',
  version: '1.0.0',
  description: 'A test Spinner used by the digest suite.',
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
  'mission-lock.md': utf8('# Mission Lock\nReview only.\n'),
  'thumbnail.svg': utf8('<svg/>'),
  'how-it-works.md': utf8('# How it works\nIt reviews things.\n'),
  './src/index.ts': utf8('export default () => "hi";\n'),
};

const fixedNow = (): Date => new Date('2026-05-12T17:00:00.000Z');

describe('computeBundleDigest', () => {
  test('produces a sha256-prefixed digest of the expected shape', async () => {
    const result = await computeBundleDigest(baseManifest, mockReader(baseFiles), fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.algorithm).toBe('sha256');
    expect(result.value.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.schema).toBe('urn:webspinner:spinner-digest:v1.0.0');
    expect(result.value.manifestCanonicalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.value.missionLockSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.value.thumbnailSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.value.entrypointSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.value.documentationSha256).toEqual([
      expect.objectContaining({ path: 'how-it-works.md' }),
    ]);
    expect(result.value.computedAt).toBe('2026-05-12T17:00:00.000Z');
  });

  test('is deterministic — same inputs produce same digest across runs', async () => {
    const a = await computeBundleDigest(baseManifest, mockReader(baseFiles), fixedNow);
    const b = await computeBundleDigest(baseManifest, mockReader(baseFiles), fixedNow);
    expect(a.ok && b.ok && a.value.digest).toBe(b.ok && b.value.digest);
  });

  test('digest changes when the manifest changes (one-byte mutation)', async () => {
    const a = await computeBundleDigest(baseManifest, mockReader(baseFiles), fixedNow);
    const mutated: SpinnerManifest = { ...baseManifest, version: '1.0.1' };
    const b = await computeBundleDigest(mutated, mockReader(baseFiles), fixedNow);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.digest).not.toBe(b.value.digest);
    }
  });

  test('digest changes when the entrypoint bytes change', async () => {
    const a = await computeBundleDigest(baseManifest, mockReader(baseFiles), fixedNow);
    const mutatedFiles = {
      ...baseFiles,
      './src/index.ts': utf8('export default () => "bye";\n'),
    };
    const b = await computeBundleDigest(baseManifest, mockReader(mutatedFiles), fixedNow);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.digest).not.toBe(b.value.digest);
      expect(a.value.entrypointSha256).not.toBe(b.value.entrypointSha256);
    }
  });

  test('digest changes when mission-lock changes', async () => {
    const a = await computeBundleDigest(baseManifest, mockReader(baseFiles), fixedNow);
    const mutatedFiles = {
      ...baseFiles,
      'mission-lock.md': utf8('# Mission Lock\nReview rigorously.\n'),
    };
    const b = await computeBundleDigest(baseManifest, mockReader(mutatedFiles), fixedNow);
    if (a.ok && b.ok) {
      expect(a.value.digest).not.toBe(b.value.digest);
      expect(a.value.missionLockSha256).not.toBe(b.value.missionLockSha256);
    }
  });

  test('mission-lock missing is allowed (missionLockSha256 = null) but still computes', async () => {
    const withoutMissionLock: Record<string, Uint8Array> = { ...baseFiles };
    delete withoutMissionLock['mission-lock.md'];
    const r = await computeBundleDigest(baseManifest, mockReader(withoutMissionLock), fixedNow);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.missionLockSha256).toBeNull();
  });

  test('thumbnail missing fails with thumbnail-missing', async () => {
    const withoutThumb: Record<string, Uint8Array> = { ...baseFiles };
    delete withoutThumb['thumbnail.svg'];
    const r = await computeBundleDigest(baseManifest, mockReader(withoutThumb), fixedNow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('thumbnail-missing');
  });

  test('documentation missing fails with documentation-missing', async () => {
    const withoutDoc: Record<string, Uint8Array> = { ...baseFiles };
    delete withoutDoc['how-it-works.md'];
    const r = await computeBundleDigest(baseManifest, mockReader(withoutDoc), fixedNow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('documentation-missing');
  });

  test('entrypoint missing fails with entrypoint-missing', async () => {
    const withoutEntry: Record<string, Uint8Array> = { ...baseFiles };
    delete withoutEntry['./src/index.ts'];
    const r = await computeBundleDigest(baseManifest, mockReader(withoutEntry), fixedNow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('entrypoint-missing');
  });

  test('documentation order follows manifest declaration order', async () => {
    const withExtras: SpinnerManifest = {
      ...baseManifest,
      documentation: {
        howItWorks: 'how-it-works.md',
        readme: 'README.md',
        examples: 'EXAMPLES.md',
        additional: [{ title: 'Theory', path: 'theory.md' }],
      },
    };
    const files: Record<string, Uint8Array> = {
      ...baseFiles,
      'README.md': utf8('# README'),
      'EXAMPLES.md': utf8('# Examples'),
      'theory.md': utf8('# Theory'),
    };
    const r = await computeBundleDigest(withExtras, mockReader(files), fixedNow);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const paths = r.value.documentationSha256.map((d: { path: string }) => d.path);
      expect(paths).toEqual(['how-it-works.md', 'README.md', 'EXAMPLES.md', 'theory.md']);
    }
  });

  test('key order in manifest does not affect digest (JCS canonicalization)', async () => {
    const reordered: SpinnerManifest = {
      manifestVersion: '1.0',
      name: '@test/example' as SpinnerName,
      displayName: 'Example',
      audit: { source: 'urn:webspinner:cell:test/example' },
      threadable: true,
      thumbnail: 'thumbnail.svg',
      documentation: { howItWorks: 'how-it-works.md' },
      capabilities: [],
      dependsOn: [],
      env: [],
      spools: [],
      vault: [],
      entrypoint: './src/index.ts',
      license: 'Apache-2.0',
      description: 'A test Spinner used by the digest suite.',
      version: '1.0.0',
    };
    const a = await computeBundleDigest(baseManifest, mockReader(baseFiles), fixedNow);
    const b = await computeBundleDigest(reordered, mockReader(baseFiles), fixedNow);
    if (a.ok && b.ok) {
      expect(a.value.digest).toBe(b.value.digest);
    }
  });
});

// Helper so vitest TS doesn't complain about the unused export type
export type _ForLint = BundleDigestRecord;
