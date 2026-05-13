/**
 * Tests for `dispatchCellAuthored`. Scaffolds the hello-spinner
 * template into tmpdirs and exercises the dynamic-import dispatch
 * path: happy path, capability variants, and each error kind.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, stat, writeFile, unlink, mkdir, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { dispatchCellAuthored, type DynamicImporter } from './weaver-cell-dispatch.js';
import { scaffoldFromTemplate, type ScaffoldVariables } from './templates.js';

/**
 * Synthetic importer for tests. Reads the bundle's src/index.ts as
 * source, then returns a pre-baked module object that matches what
 * the production native import would yield. Vitest's vmContext blocks
 * real dynamic import of arbitrary filesystem paths; we work around
 * by simulating the module exports based on the source pattern.
 *
 * Recognizes two patterns hello-spinner-shaped Spinners take:
 *
 *   1. `export default { greet };` + a top-level `export function greet(...)`
 *   2. `export function greet(...)` alone (top-level only)
 *
 * Plus the synthetic test patterns used in the suite:
 *
 *   - source contains `throw new Error('synthetic test failure')`:
 *     return a greet that throws.
 *   - source contains `'Top, '`: return the top-level Top greeter.
 *   - source `export default {}; export function someOther`:
 *     return a module without a `greet` handler.
 */
function makeSyntheticImporter(): DynamicImporter {
  return async (url: string): Promise<Record<string, unknown>> => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(url);
    const source = await readFile(path, 'utf8');

    if (source.includes("throw new Error('synthetic test failure')")) {
      const greet = () => {
        throw new Error('synthetic test failure');
      };
      return { default: { greet }, greet };
    }
    if (source.includes("'Top, '")) {
      const greet = (input: { name: string }) => ({
        greeting: 'Top, ' + input.name,
        greetedAt: new Date().toISOString(),
      });
      return { greet };
    }
    if (source.includes('export function someOther')) {
      return {
        default: {},
        someOther: () => undefined,
      };
    }
    // Default: hello-spinner-shaped exports.
    const greet = (input: { name: string; salutation?: string }) => ({
      greeting: `${input.salutation ?? 'Hello'}, ${input.name}`,
      greetedAt: new Date().toISOString(),
    });
    return { default: { greet }, greet };
  };
}

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

function fixtureVars(slug: string): ScaffoldVariables {
  return {
    slug,
    name: `@local/${slug}`,
    displayName: 'Test Spinner',
    description: 'A test Spinner used by the dispatch suite.',
    authorEmail: 'test@example.com',
    cellFingerprint: 'abc123def456ghij',
    createdAt: '2026-05-12T17:00:00.000Z',
  };
}

async function stageSpinner(slug: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'warp-dispatch-test-'));
  stagedDirs.push(parent);
  const dest = join(parent, slug);
  const r = await scaffoldFromTemplate({
    templateName: 'hello-spinner',
    destDir: dest,
    vars: fixtureVars(slug),
  });
  if (!r.ok) throw new Error(`scaffold failed: ${r.error.kind}`);
  return dest;
}

describe('dispatchCellAuthored', async () => {
  const hasTemplates = await templatesExist();

  it.skipIf(!hasTemplates)('happy path: greet returns the expected greeting', async () => {
    const bundle = await stageSpinner('test-greet-1');
    const result = await dispatchCellAuthored({
      bundlePath: bundle,
      capability: 'greet',
      input: { name: 'World' },
      importer: makeSyntheticImporter(),
    });
    if (!result.ok) {
      console.error('dispatch error:', result.error);
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value.output as { greeting: string; greetedAt: string };
    expect(output.greeting).toBe('Hello, World');
    expect(output.greetedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!hasTemplates)('salutation override works', async () => {
    const bundle = await stageSpinner('test-greet-2');
    const result = await dispatchCellAuthored({
      bundlePath: bundle,
      capability: 'greet',
      input: { name: 'Webspinner', salutation: 'Howdy' },
      importer: makeSyntheticImporter(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value.output as { greeting: string };
    expect(output.greeting).toBe('Howdy, Webspinner');
  });

  it.skipIf(!hasTemplates)('capability-unknown when not declared', async () => {
    const bundle = await stageSpinner('test-unknown-cap');
    const result = await dispatchCellAuthored({
      bundlePath: bundle,
      capability: 'doesNotExist',
      input: {},
      importer: makeSyntheticImporter(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('capability-unknown');
  });

  it('manifest-missing when manifest.json absent', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'warp-dispatch-empty-'));
    stagedDirs.push(parent);
    // Empty directory, no manifest.json.
    const result = await dispatchCellAuthored({
      bundlePath: parent,
      capability: 'greet',
      input: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('manifest-missing');
  });

  it('manifest-invalid when JSON malformed', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'warp-dispatch-bad-'));
    stagedDirs.push(parent);
    await writeFile(join(parent, 'manifest.json'), '{not json', 'utf8');
    const result = await dispatchCellAuthored({
      bundlePath: parent,
      capability: 'greet',
      input: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('manifest-invalid');
  });

  it.skipIf(!hasTemplates)('entrypoint-not-found when entrypoint deleted', async () => {
    const bundle = await stageSpinner('test-no-entry');
    await unlink(join(bundle, 'src/index.ts'));
    const result = await dispatchCellAuthored({
      bundlePath: bundle,
      capability: 'greet',
      input: { name: 'X' },
      importer: makeSyntheticImporter(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('entrypoint-not-found');
  });

  it.skipIf(!hasTemplates)('capability-not-exported when handler missing', async () => {
    const bundle = await stageSpinner('test-no-handler');
    // Rewrite src/index.ts to export nothing useful — just a no-op
    // default + no `greet` function.
    await writeFile(
      join(bundle, 'src/index.ts'),
      'export default {};\nexport function someOther() {}\n',
      'utf8',
    );
    const result = await dispatchCellAuthored({
      bundlePath: bundle,
      capability: 'greet',
      input: { name: 'X' },
      importer: makeSyntheticImporter(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('capability-not-exported');
  });

  it.skipIf(!hasTemplates)('handler-threw when the handler throws', async () => {
    const bundle = await stageSpinner('test-throw');
    await writeFile(
      join(bundle, 'src/index.ts'),
      `export function greet() { throw new Error('synthetic test failure'); }
export default { greet };
`,
      'utf8',
    );
    const result = await dispatchCellAuthored({
      bundlePath: bundle,
      capability: 'greet',
      input: { name: 'X' },
      importer: makeSyntheticImporter(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('handler-threw');
    if (result.error.kind === 'handler-threw') {
      expect(result.error.detail).toContain('synthetic test failure');
    }
  });

  it.skipIf(!hasTemplates)('handler exported only at top level (no default) resolves', async () => {
    const bundle = await stageSpinner('test-top-level');
    await writeFile(
      join(bundle, 'src/index.ts'),
      `export function greet(input) {
  return { greeting: 'Top, ' + input.name, greetedAt: new Date().toISOString() };
}
`,
      'utf8',
    );
    const result = await dispatchCellAuthored({
      bundlePath: bundle,
      capability: 'greet',
      input: { name: 'Layer' },
      importer: makeSyntheticImporter(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value.output as { greeting: string }).greeting).toBe('Top, Layer');
  });
});

// Touch readFile + mkdir so prettier doesn't strip the imports for tests
// that may not use them in every test path.
void readFile;
void mkdir;
