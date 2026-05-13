import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getScenario, listScenarios, substitutePlaceholders } from './loader.js';

const TMP = resolve(tmpdir(), `wt-loader-test-${Date.now()}`);

const VALID_SCENARIO = {
  slug: 'demo',
  title: 'Demo',
  summary: 'A test scenario.',
  version: 1,
  steps: [
    {
      key: 'one',
      title: 'Step one',
      observation: 'Look at the thing.',
      question: { kind: 'confirm' },
    },
    {
      key: 'two',
      title: 'Step two',
      observation: 'Now do the thing.',
      verifier: { kind: 'route-status', path: '/admin', expectStatus: 200 },
      question: { kind: 'verify+comment', prompt: 'Did it work?' },
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

describe('weavers-tension loader', () => {
  it('loads a valid scenario', async () => {
    await setupTmp();
    await writeFile(resolve(TMP, 'demo.json'), JSON.stringify(VALID_SCENARIO));
    const r = await getScenario('demo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.slug).toBe('demo');
      expect(r.value.steps).toHaveLength(2);
      expect(r.value.steps[1]?.verifier?.kind).toBe('route-status');
    }
  });

  it('lists scenarios from the directory', async () => {
    await setupTmp();
    await writeFile(resolve(TMP, 'demo.json'), JSON.stringify(VALID_SCENARIO));
    await writeFile(
      resolve(TMP, 'other.json'),
      JSON.stringify({ ...VALID_SCENARIO, slug: 'other', title: 'Other' }),
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

  it('rejects a scenario whose filename does not match its slug field', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'wrong.json'),
      JSON.stringify({ ...VALID_SCENARIO, slug: 'demo' }),
    );
    const r = await getScenario('wrong');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('schema-invalid');
  });

  it('rejects unknown question kinds', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'demo.json'),
      JSON.stringify({
        ...VALID_SCENARIO,
        steps: [{ key: 'one', title: 'One', observation: 'X', question: { kind: 'mystery' } }],
      }),
    );
    const r = await getScenario('demo');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'schema-invalid')
      expect(r.error.detail).toContain('unknown question kind');
  });

  it('rejects unknown verifier kinds', async () => {
    await setupTmp();
    await writeFile(
      resolve(TMP, 'demo.json'),
      JSON.stringify({
        ...VALID_SCENARIO,
        steps: [
          {
            key: 'one',
            title: 'One',
            observation: 'X',
            verifier: { kind: 'witchcraft' },
            question: { kind: 'confirm' },
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
        ...VALID_SCENARIO,
        steps: [
          { key: 'dup', title: 'A', observation: 'X', question: { kind: 'confirm' } },
          { key: 'dup', title: 'B', observation: 'Y', question: { kind: 'confirm' } },
        ],
      }),
    );
    const r = await getScenario('demo');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'schema-invalid')
      expect(r.error.detail).toContain('duplicate step key');
  });

  it('substitutes placeholders', () => {
    const answers = { newSpinner: { slug: 'tension-demo', displayName: 'Tension Demo' } };
    expect(substitutePlaceholders('/admin/spinners/{{answer.newSpinner.slug}}', answers)).toBe(
      '/admin/spinners/tension-demo',
    );
    expect(substitutePlaceholders('{{answer.unknown.field}}', answers)).toBe(
      '{{answer.unknown.field}}',
    );
  });

  it('loads the canonical webspinner-author scenario from the repo', async () => {
    // Use the real scenarios dir, not the tmp one.
    delete process.env['WARP_SCENARIOS_DIR'];
    const r = await getScenario('webspinner-author');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.steps.length).toBe(13);
      expect(r.value.steps[0]?.key).toBe('open-admin');
      expect(r.value.steps[12]?.key).toBe('refresh-integrity');
    }
  });
});
