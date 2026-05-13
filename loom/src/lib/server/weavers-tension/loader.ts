/**
 * Scenario loader (v2) — reads `<repoRoot>/scenarios/<slug>.json`,
 * validates against the v2 schema, returns typed objects.
 *
 * v2 model: scenarios declare narration + scripted actions per step
 * + verifications + optional onError remediation. Fixtures are
 * scenario-level constants substitutable into actions/verifiers.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  Action,
  ClickAction,
  FillAction,
  IframeElementVerifier,
  NarrateAction,
  NavigateIframeAction,
  OnErrorBlock,
  Scenario,
  ScenarioStep,
  SleepAction,
  StepVerifier,
  SubmitAction,
  WaitForRouteAction,
  WaitForSelectorAction,
} from './types.js';

function scenariosDir(): string {
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
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { ok: false, error: { kind: 'not-found', slug } };
    return { ok: false, error: { kind: 'read-failed', slug, detail: String(err) } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: { kind: 'parse-failed', slug, detail: String(err) } };
  }
  return validateScenario(slug, parsed);
}

function fail(slug: string, detail: string): LoadResult<never> {
  return { ok: false, error: { kind: 'schema-invalid', slug, detail } };
}

function validateScenario(slug: string, raw: unknown): LoadResult<Scenario> {
  if (typeof raw !== 'object' || raw === null) return fail(slug, 'root must be an object');
  const o = raw as Record<string, unknown>;
  if (o['slug'] !== slug) return fail(slug, `slug "${String(o['slug'])}" does not match filename`);
  if (typeof o['title'] !== 'string' || (o['title'] as string).length === 0)
    return fail(slug, 'title is required');
  if (typeof o['summary'] !== 'string') return fail(slug, 'summary is required');
  if (o['version'] !== 2) return fail(slug, `version must be 2 (got ${String(o['version'])})`);
  const fixtures = o['fixtures'];
  if (
    typeof fixtures !== 'object' ||
    fixtures === null ||
    Array.isArray(fixtures) ||
    !Object.values(fixtures).every((v) => typeof v === 'string')
  ) {
    return fail(slug, 'fixtures must be an object of string→string entries');
  }
  if (!Array.isArray(o['steps']) || (o['steps'] as unknown[]).length === 0) {
    return fail(slug, 'steps must be a non-empty array');
  }
  const steps: ScenarioStep[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < (o['steps'] as unknown[]).length; i++) {
    const stepRaw = (o['steps'] as unknown[])[i];
    const stepResult = validateStep(slug, stepRaw, i);
    if (!stepResult.ok) return stepResult;
    if (seenKeys.has(stepResult.value.key))
      return fail(slug, `duplicate step key "${stepResult.value.key}" at index ${i}`);
    seenKeys.add(stepResult.value.key);
    steps.push(stepResult.value);
  }
  return {
    ok: true,
    value: {
      slug,
      title: o['title'] as string,
      summary: o['summary'] as string,
      version: 2,
      fixtures: fixtures as Record<string, string>,
      steps,
    },
  };
}

function validateStep(slug: string, raw: unknown, idx: number): LoadResult<ScenarioStep> {
  if (typeof raw !== 'object' || raw === null) return fail(slug, `step ${idx} must be an object`);
  const o = raw as Record<string, unknown>;
  if (typeof o['key'] !== 'string' || (o['key'] as string).length === 0)
    return fail(slug, `step ${idx} missing key`);
  if (typeof o['title'] !== 'string') return fail(slug, `step ${idx} missing title`);
  if (typeof o['narration'] !== 'string') return fail(slug, `step ${idx} missing narration`);
  if (!Array.isArray(o['actions'])) return fail(slug, `step ${idx} missing actions array`);
  const actions: Action[] = [];
  for (let i = 0; i < (o['actions'] as unknown[]).length; i++) {
    const ar = validateAction(slug, (o['actions'] as unknown[])[i], `step ${idx} action ${i}`);
    if (!ar.ok) return ar;
    actions.push(ar.value);
  }
  let verifications: StepVerifier[] | undefined;
  if (o['verifications'] !== undefined) {
    if (!Array.isArray(o['verifications']))
      return fail(slug, `step ${idx} verifications must be array`);
    verifications = [];
    for (let i = 0; i < (o['verifications'] as unknown[]).length; i++) {
      const vr = validateVerifier(
        slug,
        (o['verifications'] as unknown[])[i],
        `step ${idx} verification ${i}`,
      );
      if (!vr.ok) return vr;
      verifications.push(vr.value);
    }
  }
  let onError: OnErrorBlock | undefined;
  if (o['onError'] !== undefined) {
    const eb = validateOnError(slug, o['onError'], `step ${idx} onError`);
    if (!eb.ok) return eb;
    onError = eb.value;
  }
  return {
    ok: true,
    value: {
      key: o['key'] as string,
      title: o['title'] as string,
      narration: o['narration'] as string,
      actions,
      ...(verifications !== undefined ? { verifications } : {}),
      ...(onError !== undefined ? { onError } : {}),
    },
  };
}

function validateAction(slug: string, raw: unknown, ctx: string): LoadResult<Action> {
  if (typeof raw !== 'object' || raw === null) return fail(slug, `${ctx} must be object`);
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  switch (kind) {
    case 'navigate-iframe':
      if (typeof o['path'] !== 'string') return fail(slug, `${ctx} navigate-iframe missing path`);
      return {
        ok: true,
        value: {
          kind: 'navigate-iframe',
          path: o['path'] as string,
          ...(typeof o['waitForRoute'] === 'string'
            ? { waitForRoute: o['waitForRoute'] as string }
            : {}),
          ...(typeof o['timeoutMs'] === 'number' ? { timeoutMs: o['timeoutMs'] as number } : {}),
        } satisfies NavigateIframeAction,
      };
    case 'wait-for-route':
      if (typeof o['path'] !== 'string') return fail(slug, `${ctx} wait-for-route missing path`);
      return {
        ok: true,
        value: {
          kind: 'wait-for-route',
          path: o['path'] as string,
          ...(typeof o['timeoutMs'] === 'number' ? { timeoutMs: o['timeoutMs'] as number } : {}),
        } satisfies WaitForRouteAction,
      };
    case 'wait-for-selector':
      if (typeof o['selector'] !== 'string')
        return fail(slug, `${ctx} wait-for-selector missing selector`);
      return {
        ok: true,
        value: {
          kind: 'wait-for-selector',
          selector: o['selector'] as string,
          ...(typeof o['timeoutMs'] === 'number' ? { timeoutMs: o['timeoutMs'] as number } : {}),
        } satisfies WaitForSelectorAction,
      };
    case 'fill':
      if (typeof o['selector'] !== 'string' || typeof o['value'] !== 'string')
        return fail(slug, `${ctx} fill missing selector/value`);
      return {
        ok: true,
        value: {
          kind: 'fill',
          selector: o['selector'] as string,
          value: o['value'] as string,
        } satisfies FillAction,
      };
    case 'click':
      if (typeof o['selector'] !== 'string') return fail(slug, `${ctx} click missing selector`);
      return {
        ok: true,
        value: {
          kind: 'click',
          selector: o['selector'] as string,
          ...(typeof o['waitForRoute'] === 'string'
            ? { waitForRoute: o['waitForRoute'] as string }
            : {}),
          ...(typeof o['timeoutMs'] === 'number' ? { timeoutMs: o['timeoutMs'] as number } : {}),
        } satisfies ClickAction,
      };
    case 'submit':
      if (typeof o['formSelector'] !== 'string')
        return fail(slug, `${ctx} submit missing formSelector`);
      return {
        ok: true,
        value: {
          kind: 'submit',
          formSelector: o['formSelector'] as string,
          ...(typeof o['waitForRoute'] === 'string'
            ? { waitForRoute: o['waitForRoute'] as string }
            : {}),
          ...(typeof o['timeoutMs'] === 'number' ? { timeoutMs: o['timeoutMs'] as number } : {}),
        } satisfies SubmitAction,
      };
    case 'sleep':
      if (typeof o['ms'] !== 'number') return fail(slug, `${ctx} sleep missing ms`);
      return {
        ok: true,
        value: { kind: 'sleep', ms: o['ms'] as number } satisfies SleepAction,
      };
    case 'narrate':
      if (typeof o['message'] !== 'string') return fail(slug, `${ctx} narrate missing message`);
      return {
        ok: true,
        value: { kind: 'narrate', message: o['message'] as string } satisfies NarrateAction,
      };
    default:
      return fail(slug, `${ctx} unknown action kind "${String(kind)}"`);
  }
}

function validateVerifier(slug: string, raw: unknown, ctx: string): LoadResult<StepVerifier> {
  if (typeof raw !== 'object' || raw === null) return fail(slug, `${ctx} must be object`);
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  switch (kind) {
    case 'route-status':
      if (typeof o['path'] !== 'string') return fail(slug, `${ctx} route-status missing path`);
      return {
        ok: true,
        value: {
          kind: 'route-status',
          path: o['path'] as string,
          ...(typeof o['expectStatus'] === 'number'
            ? { expectStatus: o['expectStatus'] as number }
            : {}),
          ...(Array.isArray(o['bodyContains'])
            ? {
                bodyContains: (o['bodyContains'] as unknown[]).filter(
                  (s): s is string => typeof s === 'string',
                ),
              }
            : {}),
        },
      };
    case 'pb-row-exists':
      if (typeof o['collection'] !== 'string' || typeof o['filter'] !== 'string')
        return fail(slug, `${ctx} pb-row-exists missing collection/filter`);
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
      if (typeof o['eventType'] !== 'string')
        return fail(slug, `${ctx} audit-event missing eventType`);
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
      if (typeof o['opKind'] !== 'string') return fail(slug, `${ctx} op-envelope missing opKind`);
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
    case 'iframe-element':
      if (typeof o['selector'] !== 'string' || typeof o['read'] !== 'string')
        return fail(slug, `${ctx} iframe-element missing selector/read`);
      if (typeof o['equals'] !== 'string' && typeof o['contains'] !== 'string')
        return fail(slug, `${ctx} iframe-element needs equals or contains`);
      return {
        ok: true,
        value: {
          kind: 'iframe-element',
          selector: o['selector'] as string,
          read: o['read'] as IframeElementVerifier['read'],
          ...(typeof o['equals'] === 'string' ? { equals: o['equals'] as string } : {}),
          ...(typeof o['contains'] === 'string' ? { contains: o['contains'] as string } : {}),
          ...(typeof o['timeoutMs'] === 'number' ? { timeoutMs: o['timeoutMs'] as number } : {}),
        },
      };
    default:
      return fail(slug, `${ctx} unknown verifier kind "${String(kind)}"`);
  }
}

function validateOnError(slug: string, raw: unknown, ctx: string): LoadResult<OnErrorBlock> {
  if (typeof raw !== 'object' || raw === null) return fail(slug, `${ctx} must be object`);
  const o = raw as Record<string, unknown>;
  if (typeof o['narration'] !== 'string') return fail(slug, `${ctx} missing narration`);
  if (!Array.isArray(o['actions'])) return fail(slug, `${ctx} missing actions`);
  const actions: Action[] = [];
  for (let i = 0; i < (o['actions'] as unknown[]).length; i++) {
    const ar = validateAction(slug, (o['actions'] as unknown[])[i], `${ctx} action ${i}`);
    if (!ar.ok) return ar;
    actions.push(ar.value);
  }
  return {
    ok: true,
    value: {
      narration: o['narration'] as string,
      actions,
      ...(typeof o['maxRetries'] === 'number' ? { maxRetries: o['maxRetries'] as number } : {}),
    },
  };
}

/**
 * Substitute `{{fixture.<key>}}` and `{{answer.<key>.<field>}}`
 * placeholders. Unresolved placeholders are preserved verbatim so
 * downstream errors are recognizable rather than silently matching
 * wrong values.
 */
export function substitutePlaceholders(
  template: string,
  fixtures: Readonly<Record<string, string>>,
  answers: Readonly<Record<string, Record<string, unknown>>> = {},
): string {
  return template
    .replace(/\{\{fixture\.([a-zA-Z0-9_-]+)\}\}/g, (_m, key) => {
      const v = fixtures[key];
      return typeof v === 'string' ? v : `{{fixture.${key}}}`;
    })
    .replace(/\{\{answer\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}\}/g, (_m, key, field) => {
      const bag = answers[key];
      if (bag === undefined) return `{{answer.${key}.${field}}}`;
      const v = bag[field];
      if (v === undefined || v === null) return `{{answer.${key}.${field}}}`;
      return String(v);
    });
}
