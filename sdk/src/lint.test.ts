import { describe, test, expect } from 'vitest';
import { lintSpinnerBundle } from './lint.js';
import type { BundleReader } from './digest.js';
import type { SpinnerManifest, SpinnerName } from './manifest.js';

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function memoryReader(files: Record<string, Uint8Array | null>): BundleReader {
  return {
    async readFile(path: string): Promise<Uint8Array | null> {
      const cleaned = path.replace(/^\.\//, '');
      return files[cleaned] ?? files[path] ?? null;
    },
  };
}

const RICH_DOC = '# How it works\n\n' + 'lorem '.repeat(60);
const RICH_MISSION = '# Mission Lock\n\n' + 'review only '.repeat(40);

const validManifest: SpinnerManifest = {
  manifestVersion: '1.0',
  name: '@webspinner-foundation/example' as SpinnerName,
  displayName: 'Example',
  version: '1.0.0',
  description: 'A test Spinner used by the lint suite.',
  license: 'Apache-2.0',
  entrypoint: './src/index.ts',
  vault: [],
  spools: [],
  env: [],
  dependsOn: [],
  capabilities: [
    {
      name: 'doSomething',
      displayName: 'Do Something',
      description: 'Demonstrates a capability with full schemas.',
      inputSchema: { type: 'object', properties: { foo: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { bar: { type: 'string' } } },
    },
  ],
  documentation: { howItWorks: 'how-it-works.md' },
  thumbnail: 'thumbnail.svg',
  threadable: true,
  audit: { source: 'urn:webspinner:cell:test/example' },
};

const validFiles: Record<string, Uint8Array> = {
  'mission-lock.md': utf8(RICH_MISSION),
  'thumbnail.svg': utf8('<svg/>'),
  'how-it-works.md': utf8(RICH_DOC),
  './src/index.ts': utf8('export default () => "hi";\n'),
};

describe('lintSpinnerBundle — happy paths', () => {
  test('valid bundle: ok, no findings, digest computed', async () => {
    const r = await lintSpinnerBundle(validManifest, memoryReader(validFiles));
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(0);
    expect(r.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(r.bundleStats.capabilityCount).toBe(1);
    expect(r.bundleStats.declaredDocCount).toBe(1);
    expect(r.bundleStats.bundleSizeBytes).toBeGreaterThan(0);
  });
});

describe('lintSpinnerBundle — schema errors', () => {
  test('missing required field returns manifest-schema error', async () => {
    const { description: _description, ...invalid } = validManifest;
    void _description;
    const r = await lintSpinnerBundle(invalid, memoryReader(validFiles));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === 'manifest-schema')).toBe(true);
  });

  test('invalid name pattern returns schema error', async () => {
    const invalid = { ...validManifest, name: 'BadName' as SpinnerName };
    const r = await lintSpinnerBundle(invalid, memoryReader(validFiles));
    expect(r.ok).toBe(false);
    expect(
      r.findings.some((f) => f.rule === 'manifest-schema' && (f.field ?? '').includes('name')),
    ).toBe(true);
  });

  test('invalid version returns schema error', async () => {
    const invalid = { ...validManifest, version: 'not-semver' };
    const r = await lintSpinnerBundle(invalid, memoryReader(validFiles));
    expect(r.ok).toBe(false);
    expect(
      r.findings.some((f) => f.rule === 'manifest-schema' && (f.field ?? '').includes('version')),
    ).toBe(true);
  });

  test('wrong manifestVersion returns schema error', async () => {
    const invalid = { ...validManifest, manifestVersion: '2.0' };
    const r = await lintSpinnerBundle(invalid, memoryReader(validFiles));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === 'manifest-schema')).toBe(true);
  });

  test('malformed manifest (not an object) returns schema error and no further lint', async () => {
    const r = await lintSpinnerBundle('not an object', memoryReader(validFiles));
    expect(r.ok).toBe(false);
    expect(r.findings.every((f) => f.rule === 'manifest-schema')).toBe(true);
  });
});

describe('lintSpinnerBundle — required files', () => {
  test('missing thumbnail returns required-files error', async () => {
    const files = { ...validFiles };
    delete files['thumbnail.svg'];
    const r = await lintSpinnerBundle(validManifest, memoryReader(files));
    expect(r.ok).toBe(false);
    expect(
      r.findings.some((f) => f.rule === 'required-files' && f.message.includes('thumbnail')),
    ).toBe(true);
  });

  test('missing entrypoint returns required-files error', async () => {
    const files = { ...validFiles };
    delete files['./src/index.ts'];
    const r = await lintSpinnerBundle(validManifest, memoryReader(files));
    expect(r.ok).toBe(false);
    expect(
      r.findings.some((f) => f.rule === 'required-files' && f.message.includes('entrypoint')),
    ).toBe(true);
  });

  test('missing how-it-works returns required-files error', async () => {
    const files = { ...validFiles };
    delete files['how-it-works.md'];
    const r = await lintSpinnerBundle(validManifest, memoryReader(files));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === 'required-files')).toBe(true);
  });
});

describe('lintSpinnerBundle — warnings', () => {
  test('short how-it-works triggers doc-content warning', async () => {
    const files = { ...validFiles, 'how-it-works.md': utf8('Too short.') };
    const r = await lintSpinnerBundle(validManifest, memoryReader(files));
    expect(r.ok).toBe(true);
    expect(
      r.findings.some(
        (f) =>
          f.severity === 'warning' &&
          f.rule === 'doc-content' &&
          f.message.includes('how-it-works'),
      ),
    ).toBe(true);
  });

  test('short mission-lock triggers doc-content warning', async () => {
    const files = { ...validFiles, 'mission-lock.md': utf8('Brief.') };
    const r = await lintSpinnerBundle(validManifest, memoryReader(files));
    expect(r.ok).toBe(true);
    expect(
      r.findings.some(
        (f) =>
          f.severity === 'warning' &&
          f.rule === 'doc-content' &&
          f.message.includes('mission-lock'),
      ),
    ).toBe(true);
  });

  test('capability without inputSchema triggers capability-schema warning', async () => {
    const manifest: SpinnerManifest = {
      ...validManifest,
      capabilities: [
        {
          name: 'plainCall',
          displayName: 'Plain Call',
          description: 'No schemas declared.',
        },
      ],
    };
    const r = await lintSpinnerBundle(manifest, memoryReader(validFiles));
    expect(r.ok).toBe(true);
    const warnRules = r.findings.filter((f) => f.severity === 'warning').map((f) => f.rule);
    expect(warnRules).toContain('capability-schema');
  });

  test('unknown license triggers license-recognized warning', async () => {
    const manifest = { ...validManifest, license: 'Not-A-Real-License' };
    const r = await lintSpinnerBundle(manifest, memoryReader(validFiles));
    expect(r.ok).toBe(true);
    expect(
      r.findings.some((f) => f.severity === 'warning' && f.rule === 'license-recognized'),
    ).toBe(true);
  });

  test('Foundation-Proprietary license is accepted (no warning)', async () => {
    const manifest = { ...validManifest, license: 'Foundation-Proprietary' };
    const r = await lintSpinnerBundle(manifest, memoryReader(validFiles));
    expect(r.ok).toBe(true);
    expect(r.findings.filter((f) => f.rule === 'license-recognized')).toHaveLength(0);
  });
});

describe('lintSpinnerBundle — bundle stats', () => {
  test('counts capabilities and declared docs correctly', async () => {
    const manifest: SpinnerManifest = {
      ...validManifest,
      capabilities: [
        validManifest.capabilities[0]!,
        { ...validManifest.capabilities[0]!, name: 'second' },
      ],
      documentation: {
        howItWorks: 'how-it-works.md',
        readme: 'README.md',
        examples: 'EXAMPLES.md',
      },
    };
    const files: Record<string, Uint8Array> = {
      ...validFiles,
      'README.md': utf8(RICH_DOC),
      'EXAMPLES.md': utf8(RICH_DOC),
    };
    const r = await lintSpinnerBundle(manifest, memoryReader(files));
    expect(r.ok).toBe(true);
    expect(r.bundleStats.capabilityCount).toBe(2);
    expect(r.bundleStats.declaredDocCount).toBe(3);
  });
});
