import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getScenario, listScenarios, substitutePlaceholders } from './loader.js';

const TMP = resolve(tmpdir(), `wt-loader-test-${Date.now()}`);

const VALID_V2 = {
  slug: 'demo',
  title: 'Demo',
  summary: 'A test scenario.',
  version: 2,
  fixtures: {
    slug: 'tension-demo',
    name: 'Tension Demo',
  },
  steps: [
    {
      key: 'one',
      title: 'Step one',
      narration: 'Doing the thing.',
      actions: [{ kind: 'navigate-iframe', path: '/admin' }],
    },
    {
      key: 'two',
      title: 'Step two',
      narration: 'Verifying.',
      actions: [{ kind: 'sleep', ms: 100 }],
      verifications: [{ kind: 'route-status', path: '/admin', expectStatus: 200 }],
    },
  ],
};

async function setupTmp(): Promise<void> {
  await mkdir(TMP, { recursive: true });
  process.env['WARP_SCENARIOS_DIR'] = TMP;
}

async function teardownTmp(): Promise<void> {
  delete process.env['WARP_SCENARIOS_DIR'];
  await rm(TMP, { recursive: true, force: true });
}

afterEach(teardownTmp);

describe('weavers-tension loader (v2)', () => {
  it('loads a valid v2 scenario', async () => {
    await setupTmp();
    await writeFile(resolve(TMP, 'demo.json'), JSON.stringify(VALID_V2));
    const r = await getScenario('demo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.slug).toBe('demo');
      expect(r.value.version).toBe(2);
      expect(r.value.fixtures['slug']).toBe('tension-demo');
      expect(r.value.steps).toHaveLength(2);
      expect(r.value.steps[1]?.verifications?.[0]?.kind).toBe('route-status');
    }
  });

  it('lists scenarios from the directory', async () => {
    await setupTmp();
    await writeFile(resolve(TMP, 'demo.json'), JSON.stringify(VALID_V2));
    await writeFile(
      resolve(TMP, 'other.json'),
      JSON.stringify({ ...VALID_V2, slug: 'other', title: 'Other' }),
    );
    const list = await listScenarios();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.slug).sort()).toEqual(['demo', 'other']);
  });

  it('returns not-found for an unknown slug', async () => {
    await setupTmp();
    const r = await getScenario('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not-found');
  });

  it('rejects v1 scenarios (version !== 2)', async () => {
    await setupTmp();
    await writeFile(resolve(TMP, 'demo.json'), JSON.stringify({ ...VALID_V2, version: 1 }));
    const r = await getScenario('demo');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'schema-invalid')
      expect(r.error.detail).toContain('version must be 2');
  });

  it('rejects scenarios missing fixtures', async () => {
    await setupTmp();
    const { fixtures: _omit, ...rest } = VALID_V2;
    await writeFile(resolve(TMP, 'demo.json'), JSON.stringify(rest));
    const r = await getScenario('demo');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'schema-invalid') expect(r.error.detail).toContain('fixtures');
  });

  it('rejects unknown action kinds', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'demo.json'),
      JSON.stringify({
        ...VALID_V2,
        steps: [
          {
            key: 'one',
            title: 'One',
            narration: 'x',
            actions: [{ kind: 'sorcery' }],
          },
        ],
      }),
    );
    const r = await getScenario('demo');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'schema-invalid')
      expect(r.error.detail).toContain('unknown action kind');
  });

  it('rejects unknown verifier kinds', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'demo.json'),
      JSON.stringify({
        ...VALID_V2,
        steps: [
          {
            key: 'one',
            title: 'One',
            narration: 'x',
            actions: [],
            verifications: [{ kind: 'witchcraft' }],
          },
        ],
      }),
    );
    const r = await getScenario('demo');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'schema-invalid')
      expect(r.error.detail).toContain('unknown verifier kind');
  });

  it('rejects duplicate step keys', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'demo.json'),
      JSON.stringify({
        ...VALID_V2,
        steps: [
          { key: 'dup', title: 'A', narration: 'x', actions: [] },
          { key: 'dup', title: 'B', narration: 'y', actions: [] },
        ],
      }),
    );
    const r = await getScenario('demo');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'schema-invalid')
      expect(r.error.detail).toContain('duplicate step key');
  });

  it('substitutes fixture and answer placeholders', () => {
    const fixtures = { slug: 'tension-demo' };
    const answers = { newSpinner: { extra: 'value' } };
    expect(substitutePlaceholders('/admin/spinners/{{fixture.slug}}', fixtures, answers)).toBe(
      '/admin/spinners/tension-demo',
    );
    expect(substitutePlaceholders('{{answer.newSpinner.extra}}', fixtures, answers)).toBe('value');
    expect(substitutePlaceholders('{{fixture.missing}}', fixtures, answers)).toBe(
      '{{fixture.missing}}',
    );
  });

  it('loads the canonical webspinner-author scenario from the repo', async () => {
    delete process.env['WARP_SCENARIOS_DIR'];
    const r = await getScenario('webspinner-author');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.version).toBe(2);
      expect(r.value.steps.length).toBeGreaterThanOrEqual(13);
      expect(r.value.steps[0]?.key).toBe('open-admin');
      expect(r.value.fixtures['slug']).toBe('tension-demo');
    }
  });

  it('parses an onError remediation block', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'demo.json'),
      JSON.stringify({
        ...VALID_V2,
        steps: [
          {
            key: 'one',
            title: 'One',
            narration: 'try',
            actions: [{ kind: 'sleep', ms: 10 }],
            verifications: [{ kind: 'route-status', path: '/x' }],
            onError: {
              narration: 'remediate',
              actions: [{ kind: 'sleep', ms: 5 }],
              maxRetries: 2,
            },
          },
        ],
      }),
    );
    const r = await getScenario('demo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.steps[0]?.onError?.maxRetries).toBe(2);
      expect(r.value.steps[0]?.onError?.actions[0]?.kind).toBe('sleep');
    }
  });

  it('parses iframe-element verifier', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'demo.json'),
      JSON.stringify({
        ...VALID_V2,
        steps: [
          {
            key: 'one',
            title: 'One',
            narration: 'check',
            actions: [],
            verifications: [
              { kind: 'iframe-element', selector: 'input[name=slug]', read: 'value', equals: 'X' },
            ],
          },
        ],
      }),
    );
    const r = await getScenario('demo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value.steps[0]?.verifications?.[0];
      expect(v?.kind).toBe('iframe-element');
      if (v?.kind === 'iframe-element') expect(v.equals).toBe('X');
    }
  });
});
