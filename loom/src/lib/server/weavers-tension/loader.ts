/**
 * Scenario loader — reads JSON files from `<repoRoot>/scenarios/<slug>.json`,
 * validates them against the Scenario schema, returns typed objects.
 *
 * Validation is structural — every field on Scenario / ScenarioStep is
 * required to be present and the correct primitive type. We do not run
 * a full JSON Schema validator; the discriminator-keyed unions make
 * structural checks straightforward and the failure messages tighter.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { Scenario, ScenarioStep, StepQuestion, StepVerifier } from './types.js';

function scenariosDir(): string {
  // Read lazily so test setups that mutate the env between calls work.
  const override = process.env['WARP_SCENARIOS_DIR'];
  if (override) return override;
  return resolve(homedir(), 'warp/scenarios');
}

export type LoadError =
  | { readonly kind: 'not-found'; readonly slug: string }
  | { readonly kind: 'read-failed'; readonly slug: string; readonly detail: string }
  | { readonly kind: 'parse-failed'; readonly slug: string; readonly detail: string }
  | { readonly kind: 'schema-invalid'; readonly slug: string; readonly detail: string };

export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LoadError };

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

function isSafeSlug(s: unknown): s is string {
  return typeof s === 'string' && SLUG_PATTERN.test(s);
}

export async function listScenarios(): Promise<
  readonly { readonly slug: string; readonly title: string; readonly summary: string }[]
> {
  let entries: readonly string[];
  try {
    entries = await readdir(scenariosDir());
  } catch {
    return [];
  }
  const result: { slug: string; title: string; summary: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const slug = entry.slice(0, -'.json'.length);
    if (!isSafeSlug(slug)) continue;
    const loaded = await getScenario(slug);
    if (loaded.ok) {
      result.push({
        slug: loaded.value.slug,
        title: loaded.value.title,
        summary: loaded.value.summary,
      });
    }
  }
  result.sort((a, b) => a.title.localeCompare(b.title));
  return result;
}

export async function getScenario(slug: string): Promise<LoadResult<Scenario>> {
  if (!isSafeSlug(slug)) {
    return { ok: false, error: { kind: 'not-found', slug } };
  }
  const path = join(scenariosDir(), `${slug}.json`);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'read-failed';
    if (msg === 'not-found') return { ok: false, error: { kind: 'not-found', slug } };
    return { ok: false, error: { kind: 'read-failed', slug, detail: String(err) } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: { kind: 'parse-failed', slug, detail: String(err) } };
  }
  const validated = validateScenario(slug, parsed);
  if (!validated.ok) return validated;
  return { ok: true, value: validated.value };
}

function validateScenario(slug: string, raw: unknown): LoadResult<Scenario> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'schema-invalid', slug, detail: 'root must be an object' } };
  }
  const o = raw as Record<string, unknown>;
  if (o['slug'] !== slug) {
    return {
      ok: false,
      error: {
        kind: 'schema-invalid',
        slug,
        detail: `slug field "${String(o['slug'])}" does not match filename "${slug}"`,
      },
    };
  }
  if (typeof o['title'] !== 'string' || (o['title'] as string).length === 0) {
    return { ok: false, error: { kind: 'schema-invalid', slug, detail: 'title is required' } };
  }
  if (typeof o['summary'] !== 'string') {
    return { ok: false, error: { kind: 'schema-invalid', slug, detail: 'summary is required' } };
  }
  if (o['version'] !== 1) {
    return {
      ok: false,
      error: {
        kind: 'schema-invalid',
        slug,
        detail: `version must be 1 (got ${String(o['version'])})`,
      },
    };
  }
  if (!Array.isArray(o['steps']) || (o['steps'] as unknown[]).length === 0) {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: 'steps must be a non-empty array' },
    };
  }
  const steps: ScenarioStep[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < (o['steps'] as unknown[]).length; i++) {
    const stepRaw = (o['steps'] as unknown[])[i];
    const stepResult = validateStep(slug, stepRaw, i);
    if (!stepResult.ok) return stepResult;
    if (seenKeys.has(stepResult.value.key)) {
      return {
        ok: false,
        error: {
          kind: 'schema-invalid',
          slug,
          detail: `duplicate step key "${stepResult.value.key}" at index ${i}`,
        },
      };
    }
    seenKeys.add(stepResult.value.key);
    steps.push(stepResult.value);
  }
  return {
    ok: true,
    value: {
      slug,
      title: o['title'] as string,
      summary: o['summary'] as string,
      version: 1,
      steps,
    },
  };
}

function validateStep(slug: string, raw: unknown, idx: number): LoadResult<ScenarioStep> {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: `step ${idx} must be an object` },
    };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o['key'] !== 'string' || (o['key'] as string).length === 0) {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: `step ${idx} missing key` },
    };
  }
  if (typeof o['title'] !== 'string') {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: `step ${idx} missing title` },
    };
  }
  if (typeof o['observation'] !== 'string') {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: `step ${idx} missing observation` },
    };
  }
  if (o['iframeRoute'] !== undefined && typeof o['iframeRoute'] !== 'string') {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: `step ${idx} iframeRoute must be string` },
    };
  }
  const questionResult = validateQuestion(slug, o['question'], idx);
  if (!questionResult.ok) return questionResult;
  let verifier: StepVerifier | undefined;
  if (o['verifier'] !== undefined) {
    const verifierResult = validateVerifier(slug, o['verifier'], idx);
    if (!verifierResult.ok) return verifierResult;
    verifier = verifierResult.value;
  }
  const step: ScenarioStep = {
    key: o['key'] as string,
    title: o['title'] as string,
    observation: o['observation'] as string,
    ...(o['iframeRoute'] !== undefined ? { iframeRoute: o['iframeRoute'] as string } : {}),
    ...(verifier !== undefined ? { verifier } : {}),
    question: questionResult.value,
    ...(typeof o['answerKey'] === 'string' ? { answerKey: o['answerKey'] as string } : {}),
  };
  return { ok: true, value: step };
}

function validateQuestion(slug: string, raw: unknown, idx: number): LoadResult<StepQuestion> {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: `step ${idx} missing question` },
    };
  }
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  switch (kind) {
    case 'confirm':
      return {
        ok: true,
        value: {
          kind: 'confirm',
          ...(typeof o['approveLabel'] === 'string'
            ? { approveLabel: o['approveLabel'] as string }
            : {}),
        },
      };
    case 'choice':
      if (typeof o['prompt'] !== 'string' || !Array.isArray(o['options'])) {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} choice question missing prompt/options`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'choice',
          prompt: o['prompt'] as string,
          options: (o['options'] as { value: string; label: string }[]).map((opt) => ({
            value: opt.value,
            label: opt.label,
          })),
          ...(typeof o['multi'] === 'boolean' ? { multi: o['multi'] as boolean } : {}),
        },
      };
    case 'prose':
      if (typeof o['prompt'] !== 'string') {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} prose question missing prompt`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'prose',
          prompt: o['prompt'] as string,
          ...(typeof o['placeholder'] === 'string'
            ? { placeholder: o['placeholder'] as string }
            : {}),
        },
      };
    case 'verify+comment':
      if (typeof o['prompt'] !== 'string') {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} verify+comment question missing prompt`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'verify+comment',
          prompt: o['prompt'] as string,
          ...(typeof o['commentPlaceholder'] === 'string'
            ? { commentPlaceholder: o['commentPlaceholder'] as string }
            : {}),
        },
      };
    case 'prompt-input':
      if (typeof o['prompt'] !== 'string' || !Array.isArray(o['fields'])) {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} prompt-input question missing prompt/fields`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'prompt-input',
          prompt: o['prompt'] as string,
          fields: (
            o['fields'] as {
              name: string;
              label: string;
              placeholder?: string;
              required?: boolean;
            }[]
          ).map((f) => ({
            name: f.name,
            label: f.label,
            ...(typeof f.placeholder === 'string' ? { placeholder: f.placeholder } : {}),
            ...(typeof f.required === 'boolean' ? { required: f.required } : {}),
          })),
        },
      };
    default:
      return {
        ok: false,
        error: {
          kind: 'schema-invalid',
          slug,
          detail: `step ${idx} unknown question kind "${String(kind)}"`,
        },
      };
  }
}

function validateVerifier(slug: string, raw: unknown, idx: number): LoadResult<StepVerifier> {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: { kind: 'schema-invalid', slug, detail: `step ${idx} verifier must be object` },
    };
  }
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  switch (kind) {
    case 'route-status':
      if (typeof o['path'] !== 'string') {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} route-status verifier missing path`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'route-status',
          path: o['path'] as string,
          ...(typeof o['expectStatus'] === 'number'
            ? { expectStatus: o['expectStatus'] as number }
            : {}),
          ...(Array.isArray(o['bodyContains'])
            ? { bodyContains: (o['bodyContains'] as string[]).filter((s) => typeof s === 'string') }
            : {}),
        },
      };
    case 'pb-row-exists':
      if (typeof o['collection'] !== 'string' || typeof o['filter'] !== 'string') {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} pb-row-exists verifier missing collection/filter`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'pb-row-exists',
          collection: o['collection'] as string,
          filter: o['filter'] as string,
          ...(typeof o['assertFields'] === 'object' && o['assertFields'] !== null
            ? { assertFields: o['assertFields'] as Record<string, string> }
            : {}),
        },
      };
    case 'audit-event':
      if (typeof o['eventType'] !== 'string') {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} audit-event verifier missing eventType`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'audit-event',
          eventType: o['eventType'] as string,
          ...(typeof o['windowSec'] === 'number' ? { windowSec: o['windowSec'] as number } : {}),
          ...(typeof o['subjectContains'] === 'string'
            ? { subjectContains: o['subjectContains'] as string }
            : {}),
        },
      };
    case 'op-envelope':
      if (typeof o['opKind'] !== 'string') {
        return {
          ok: false,
          error: {
            kind: 'schema-invalid',
            slug,
            detail: `step ${idx} op-envelope verifier missing opKind`,
          },
        };
      }
      return {
        ok: true,
        value: {
          kind: 'op-envelope',
          opKind: o['opKind'] as string,
          ...(o['status'] === 'ok' || o['status'] === 'failed' || o['status'] === 'partial'
            ? { status: o['status'] as 'ok' | 'failed' | 'partial' }
            : {}),
          ...(typeof o['windowSec'] === 'number' ? { windowSec: o['windowSec'] as number } : {}),
        },
      };
    default:
      return {
        ok: false,
        error: {
          kind: 'schema-invalid',
          slug,
          detail: `step ${idx} unknown verifier kind "${String(kind)}"`,
        },
      };
  }
}

/**
 * Substitute `{{answer.<key>.<field>}}` placeholders in a string with
 * values from the run's accumulated answers. Unresolved placeholders
 * are left in-place (useful for steps that run before the answer was
 * captured — the verifier will then fail recognizably rather than
 * silently match the wrong row).
 */
export function substitutePlaceholders(
  template: string,
  answers: Record<string, Record<string, unknown>>,
): string {
  return template.replace(
    /\{\{answer\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}\}/g,
    (_match, key, field) => {
      const bag = answers[key];
      if (bag === undefined) return `{{answer.${key}.${field}}}`;
      const value = bag[field];
      if (value === undefined || value === null) return `{{answer.${key}.${field}}}`;
      return String(value);
    },
  );
}
