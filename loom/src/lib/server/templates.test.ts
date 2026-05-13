/**
 * Tests for the template registry + scaffold helper. Exercises both
 * the listing + scaffolding paths against the real hello-spinner
 * template, and the integration round-trip: scaffold → lint clean.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  listTemplates,
  getTemplate,
  scaffoldFromTemplate,
  type ScaffoldVariables,
} from './templates.js';
import { lintSpinnerBundle, type SpinnerManifest } from '@webspinner-foundation/sdk';
import { nodeProvenanceIO } from './provenance-node.js';

const HELLO_SPINNER_DIR = resolve(homedir(), 'warp/templates/hello-spinner');

async function templatesExist(): Promise<boolean> {
  try {
    const s = await stat(HELLO_SPINNER_DIR);
    return s.isDirectory();
  } catch {
    return false;
  }
}

const stagedDirs: string[] = [];
afterEach(async () => {
  for (const dir of stagedDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

async function destTmpDir(): Promise<string> {
  // Scaffold destination MUST NOT exist when we call scaffoldFromTemplate,
  // so we mkdtemp a parent, then point at a non-existent child path.
  const parent = await mkdtemp(join(tmpdir(), 'warp-template-test-'));
  stagedDirs.push(parent);
  return join(parent, 'scaffolded');
}

function fixtureVars(over: Partial<ScaffoldVariables> = {}): ScaffoldVariables {
  return {
    slug: 'my-test-spinner',
    name: '@local/my-test-spinner',
    displayName: 'My Test Spinner',
    description: 'A test Spinner scaffolded from the hello-spinner template.',
    authorEmail: 'test@example.com',
    cellFingerprint: 'abc123def456ghij',
    createdAt: '2026-05-12T17:00:00.000Z',
    ...over,
  };
}

describe('templates registry', async () => {
  const hasTemplates = await templatesExist();

  it.skipIf(!hasTemplates)(
    'listTemplates includes hello-spinner with the expected meta',
    async () => {
      const templates = await listTemplates();
      const hello = templates.find((t) => t.name === 'hello-spinner');
      expect(hello).toBeDefined();
      if (!hello) return;
      expect(hello.displayName).toBe('Hello Spinner');
      expect(hello.version).toBe('1.0.0');
      expect(hello.description.length).toBeGreaterThan(20);
    },
  );

  it.skipIf(!hasTemplates)('getTemplate returns meta for a known template', async () => {
    const meta = await getTemplate('hello-spinner');
    expect(meta).not.toBeNull();
    if (!meta) return;
    expect(meta.name).toBe('hello-spinner');
  });

  it('getTemplate returns null for an unknown template', async () => {
    const meta = await getTemplate('no-such-template-xyz');
    expect(meta).toBeNull();
  });

  it('getTemplate refuses path-traversal in the name', async () => {
    expect(await getTemplate('../etc')).toBeNull();
    expect(await getTemplate('foo/bar')).toBeNull();
    expect(await getTemplate('..')).toBeNull();
  });
});

describe('scaffoldFromTemplate', async () => {
  const hasTemplates = await templatesExist();

  it.skipIf(!hasTemplates)('scaffolds hello-spinner with substituted placeholders', async () => {
    const dest = await destTmpDir();
    const vars = fixtureVars();
    const result = await scaffoldFromTemplate({
      templateName: 'hello-spinner',
      destDir: dest,
      vars,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 8 files written (9 in template minus meta.json).
    expect(result.filesWritten.length).toBe(8);

    // meta.json must NOT be in the scaffolded bundle.
    let metaError: Error | null = null;
    try {
      await stat(join(dest, 'meta.json'));
    } catch (e) {
      metaError = e as Error;
    }
    expect(metaError).not.toBeNull();

    // manifest.json placeholders substituted.
    const manifestRaw = await readFile(join(dest, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as SpinnerManifest;
    expect(manifest.name).toBe(vars.name);
    expect(manifest.displayName).toBe(vars.displayName);
    expect(manifest.description).toBe(vars.description);
    expect(manifest.audit.source).toContain(vars.cellFingerprint);
    expect(manifest.audit.source).toContain(vars.slug);

    // mission-lock placeholders substituted.
    const missionLock = await readFile(join(dest, 'mission-lock.md'), 'utf8');
    expect(missionLock).toContain(vars.displayName);
    expect(missionLock).toContain(vars.authorEmail);
    expect(missionLock).toContain(vars.createdAt);

    // No residual {{placeholder}} tokens anywhere.
    for (const file of result.filesWritten) {
      const content = await readFile(join(dest, file), 'utf8');
      expect(content).not.toContain('{{');
      expect(content).not.toContain('}}');
    }
  });

  it.skipIf(!hasTemplates)('scaffolded bundle lints clean (round-trip integration)', async () => {
    const dest = await destTmpDir();
    const result = await scaffoldFromTemplate({
      templateName: 'hello-spinner',
      destDir: dest,
      vars: fixtureVars(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Lint the scaffolded bundle.
    const manifestRaw = await readFile(join(dest, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as SpinnerManifest;
    const reader = nodeProvenanceIO(dest).reader;
    const lintResult = await lintSpinnerBundle(manifest, reader);

    expect(lintResult.ok).toBe(true);
    // Allow advisory warnings (e.g., short README is acceptable for a
    // minimal template); errors are not.
    const errors = lintResult.findings.filter((f) => f.severity === 'error');
    if (errors.length > 0) {
      // Surface the errors when this fails so the failure is actionable.

      console.error('Template scaffolded with lint errors:', errors);
    }
    expect(errors).toHaveLength(0);
  });

  it('template-not-found returns the expected error kind', async () => {
    const dest = await destTmpDir();
    const result = await scaffoldFromTemplate({
      templateName: 'definitely-not-a-real-template',
      destDir: dest,
      vars: fixtureVars(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('template-not-found');
  });

  it.skipIf(!hasTemplates)('dest-already-exists when destination is populated', async () => {
    const dest = await destTmpDir();
    // Pre-create the destination with some content.
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'existing.txt'), 'preexisting', 'utf8');

    const result = await scaffoldFromTemplate({
      templateName: 'hello-spinner',
      destDir: dest,
      vars: fixtureVars(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('dest-already-exists');
  });
});
