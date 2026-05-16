/**
 * Weaver's Tension — run executor.
 *
 * Drives a Scenario through to completion. The player Svelte gives us
 * an IframeDriver (for DOM ops), hook callbacks (for UI/server side
 * effects), and signal callbacks (pause/stop). We iterate the steps,
 * narrate each one, execute its actions, verify, remediate on
 * failure, escalate if remediation fails, and finally finish.
 *
 * Everything async is `stopGuard()`-checked + `paused()`-awaited at
 * yield points so the patron's Pause/Stop is responsive.
 */

import { IframeDriver, DriverError, sleep } from './driver.js';
import type {
  Action,
  Scenario,
  ScenarioStep,
  StepResult,
  StepVerifier,
  VerifierResult,
} from '../server/weavers-tension/types.js';

export interface ExecutorSignals {
  readonly paused: () => Promise<void>;
  readonly stopRequested: () => boolean;
  readonly stopGuard: () => void;
}

export interface ExecutorHooks {
  /** Called when a step becomes active. Auto-posts narration. */
  onStepStart(step: ScenarioStep, index: number): Promise<void>;
  /** Called before each action runs. */
  onAction(action: Action, step: ScenarioStep, label: string): void;
  /** Called after every verifier execution (success or fail). */
  onVerifierResult(step: ScenarioStep, result: VerifierResult): void;
  /** Called when a step concludes (any terminal status). */
  onStepDone(
    step: ScenarioStep,
    status: StepResult['status'],
    evidence?: Record<string, unknown>,
  ): Promise<void>;
  /** Post a chat message. authorKind='si' for narration, 'system' for control events. */
  postMessage(authorKind: 'si' | 'system', step: ScenarioStep | null, body: string): Promise<void>;
  /** Run a server-side verifier (route-status, pb-row-exists, audit-event, op-envelope). */
  runServerVerifier(step: ScenarioStep, verifier: StepVerifier): Promise<VerifierResult>;
  /** Called when a step fails after retries. The executor halts; patron decides. */
  onEscalate(step: ScenarioStep, reason: string, evidence: Record<string, unknown>): Promise<void>;
  /** Called when the run completes cleanly. */
  onFinish(): Promise<void>;
}

export interface ExecutorInput {
  readonly driver: IframeDriver;
  readonly scenario: Scenario;
  /** Starting index. Resume-friendly. */
  readonly startIndex: number;
  /** Answers from the run (used for placeholder substitution). */
  readonly answers: Readonly<Record<string, Record<string, unknown>>>;
  readonly hooks: ExecutorHooks;
  readonly signals: ExecutorSignals;
}

export async function executeRun(input: ExecutorInput): Promise<void> {
  const { driver, scenario, hooks, signals } = input;

  for (let i = input.startIndex; i < scenario.steps.length; i++) {
    signals.stopGuard();
    await signals.paused();
    const step = scenario.steps[i];
    if (!step) break;

    await hooks.onStepStart(step, i);
    await hooks.postMessage('si', step, step.narration);

    let evidence: Record<string, unknown> | undefined;
    let attempt = 0;
    const maxAttempts = (step.onError?.maxRetries ?? 0) + 1;
    let succeeded = false;
    let lastEscalationReason = '';

    while (attempt < maxAttempts && !succeeded) {
      if (signals.stopRequested()) return;
      attempt++;

      try {
        if (attempt === 1) {
          await runActions(driver, scenario, input.answers, step.actions, step, hooks, signals);
        } else if (step.onError) {
          await hooks.postMessage('si', step, step.onError.narration);
          await runActions(
            driver,
            scenario,
            input.answers,
            step.onError.actions,
            step,
            hooks,
            signals,
          );
        }
      } catch (err) {
        const detail = err instanceof DriverError ? err.detail : { error: String(err) };
        const reason =
          err instanceof DriverError
            ? plainEnglishDriverError(err)
            : `Unexpected error while executing actions: ${String(err)}`;
        lastEscalationReason = reason;
        evidence = { ...(evidence ?? {}), [`attempt-${attempt}-driverError`]: detail };
        await hooks.postMessage('si', step, `Step "${step.title}" hit a snag: ${reason}`);
        continue; // try remediation on next loop iteration if available
      }

      // Run verifications
      let allVerifiersOk = true;
      const stepEvidence: Record<string, unknown> = {};
      for (const v of step.verifications ?? []) {
        signals.stopGuard();
        await signals.paused();
        const result = await runOneVerifier(driver, scenario, input.answers, step, v, hooks);
        hooks.onVerifierResult(step, result);
        stepEvidence[verifierLabel(v)] = result;
        if (!result.ok) {
          allVerifiersOk = false;
          await hooks.postMessage(
            'si',
            step,
            plainEnglishVerifierFailure(v, result, scenario, input.answers),
          );
        }
      }
      evidence = { ...(evidence ?? {}), [`attempt-${attempt}`]: stepEvidence };
      if (allVerifiersOk) {
        succeeded = true;
      } else {
        lastEscalationReason = 'verifier(s) failed';
      }
    }

    if (succeeded) {
      const status = attempt > 1 ? 'remediated' : 'completed';
      if (status === 'remediated') {
        await hooks.postMessage(
          'si',
          step,
          `Remediation succeeded — step "${step.title}" complete.`,
        );
      }
      await hooks.onStepDone(step, status, evidence);
    } else {
      await hooks.onStepDone(step, 'failed', evidence);
      await hooks.onEscalate(step, lastEscalationReason, evidence ?? {});
      return;
    }
  }

  await hooks.onFinish();
}

// ── action execution ────────────────────────────────────────────

async function runActions(
  driver: IframeDriver,
  scenario: Scenario,
  answers: Readonly<Record<string, Record<string, unknown>>>,
  actions: readonly Action[],
  step: ScenarioStep,
  hooks: ExecutorHooks,
  signals: ExecutorSignals,
): Promise<void> {
  for (const action of actions) {
    signals.stopGuard();
    await signals.paused();
    hooks.onAction(action, step, actionLabel(action, scenario, answers));
    await executeAction(driver, scenario, answers, action, step, hooks);
  }
}

async function executeAction(
  driver: IframeDriver,
  scenario: Scenario,
  answers: Readonly<Record<string, Record<string, unknown>>>,
  action: Action,
  step: ScenarioStep,
  hooks: ExecutorHooks,
): Promise<void> {
  const sub = (s: string) => subst(s, scenario, answers);
  switch (action.kind) {
    case 'navigate-iframe':
      await driver.navigate(sub(action.path), {
        ...(action.waitForRoute !== undefined ? { waitForRoute: sub(action.waitForRoute) } : {}),
        ...(action.timeoutMs !== undefined ? { timeoutMs: action.timeoutMs } : {}),
      });
      return;
    case 'wait-for-route':
      await driver.waitForRoute(sub(action.path), action.timeoutMs ?? 8000);
      return;
    case 'wait-for-selector':
      // Selectors can carry placeholders too (a scenario may want
      // to wait for `input[value='{{fixture.slug}}']` to confirm a
      // fill; or a `[data-id='{{answer.X.Y}}']`). Substitute everywhere.
      await driver.waitForSelector(sub(action.selector), action.timeoutMs ?? 8000);
      return;
    case 'fill':
      await driver.fill(sub(action.selector), sub(action.value));
      return;
    case 'click':
      await driver.click(sub(action.selector), {
        ...(action.waitForRoute !== undefined ? { waitForRoute: sub(action.waitForRoute) } : {}),
        ...(action.timeoutMs !== undefined ? { timeoutMs: action.timeoutMs } : {}),
      });
      return;
    case 'submit':
      await driver.submit(sub(action.formSelector), {
        ...(action.waitForRoute !== undefined ? { waitForRoute: sub(action.waitForRoute) } : {}),
        ...(action.timeoutMs !== undefined ? { timeoutMs: action.timeoutMs } : {}),
      });
      return;
    case 'sleep':
      await sleep(action.ms);
      return;
    case 'narrate':
      await hooks.postMessage('si', step, sub(action.message));
      return;
  }
}

// ── verifier execution ──────────────────────────────────────────

async function runOneVerifier(
  driver: IframeDriver,
  scenario: Scenario,
  answers: Readonly<Record<string, Record<string, unknown>>>,
  step: ScenarioStep,
  verifier: StepVerifier,
  hooks: ExecutorHooks,
): Promise<VerifierResult> {
  if (verifier.kind === 'iframe-element') {
    return await runIframeElementVerifier(driver, scenario, answers, verifier);
  }
  // Server-side verifiers: delegate to the hook (calls the runVerifications form action).
  return await hooks.runServerVerifier(step, verifier);
}

async function runIframeElementVerifier(
  driver: IframeDriver,
  scenario: Scenario,
  answers: Readonly<Record<string, Record<string, unknown>>>,
  verifier: import('../server/weavers-tension/types.js').IframeElementVerifier,
): Promise<VerifierResult> {
  const sub = (s: string) => subst(s, scenario, answers);
  const expected = verifier.equals !== undefined ? sub(verifier.equals) : undefined;
  const contains = verifier.contains !== undefined ? sub(verifier.contains) : undefined;
  const selector = sub(verifier.selector);
  const read = await driver.readElement(selector, verifier.read, verifier.timeoutMs ?? 4000);
  if (!read.ok) {
    return {
      ok: false,
      observation: `Could not read ${verifier.read} on "${selector}": ${read.reason}`,
      evidence: { selector: selector, read: verifier.read, reason: read.reason },
    };
  }
  if (expected !== undefined && read.value !== expected) {
    return {
      ok: false,
      observation: `${selector}.${verifier.read} = "${read.value}", expected "${expected}"`,
      evidence: { selector: selector, read: verifier.read, expected, actual: read.value },
    };
  }
  if (contains !== undefined && !read.value.includes(contains)) {
    return {
      ok: false,
      observation: `${selector}.${verifier.read} = "${read.value}" — does not contain "${contains}"`,
      evidence: { selector: selector, read: verifier.read, contains, actual: read.value },
    };
  }
  return {
    ok: true,
    observation: `${selector}.${verifier.read} matched.`,
    evidence: { selector: selector, read: verifier.read, value: read.value },
  };
}

// ── substitution + plain-English explanations ───────────────────

function subst(
  s: string,
  scenario: Scenario,
  answers: Readonly<Record<string, Record<string, unknown>>>,
): string {
  return s
    .replace(/\{\{fixture\.([a-zA-Z0-9_-]+)\}\}/g, (_m, key) => {
      const v = scenario.fixtures[key];
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

function actionLabel(
  action: Action,
  scenario: Scenario,
  answers: Readonly<Record<string, Record<string, unknown>>>,
): string {
  const sub = (s: string) => subst(s, scenario, answers);
  switch (action.kind) {
    case 'navigate-iframe':
      return `Navigating to ${sub(action.path)}`;
    case 'wait-for-route':
      return `Waiting for ${sub(action.path)}`;
    case 'wait-for-selector':
      return `Waiting for "${action.selector}"`;
    case 'fill':
      return `Filling ${action.selector} with "${sub(action.value).slice(0, 60)}${sub(action.value).length > 60 ? '…' : ''}"`;
    case 'click':
      return `Clicking ${action.selector}`;
    case 'submit':
      return `Submitting ${action.formSelector}`;
    case 'sleep':
      return `Pause (${action.ms}ms)`;
    case 'narrate':
      return `Narrating`;
  }
}

function verifierLabel(v: StepVerifier): string {
  switch (v.kind) {
    case 'route-status':
      return `route-status ${v.path}`;
    case 'pb-row-exists':
      return `pb-row-exists ${v.collection}`;
    case 'audit-event':
      return `audit-event ${v.eventType}`;
    case 'op-envelope':
      return `op-envelope ${v.opKind}`;
    case 'iframe-element':
      return `iframe-element ${v.selector}.${v.read}`;
  }
}

function plainEnglishDriverError(err: DriverError): string {
  switch (err.message) {
    case 'timeout-wait-for-route':
      return `The iframe didn't reach ${(err.detail as { expected: string }).expected} in time. Last URL: ${(err.detail as { observed: string }).observed}.`;
    case 'timeout-wait-for-selector':
      return `The element "${(err.detail as { selector: string }).selector}" never appeared.`;
    case 'timeout-iframe-load':
      return `The iframe took too long to load.`;
    case 'fill-target-not-input':
      return `Tried to fill "${(err.detail as { selector: string }).selector}" but it's not an input or textarea.`;
    case 'submit-target-not-form':
      return `Tried to submit "${(err.detail as { formSelector: string }).formSelector}" but it's not a form.`;
    case 'iframe-contentDocument-null':
      return `The iframe document isn't accessible — same-origin restriction or detached frame.`;
    case 'iframe-contentWindow-null':
      return `The iframe window isn't accessible.`;
    default:
      return `Driver error: ${err.message}`;
  }
}

function plainEnglishVerifierFailure(
  v: StepVerifier,
  r: VerifierResult,
  _scenario: Scenario,
  _answers: Readonly<Record<string, Record<string, unknown>>>,
): string {
  switch (v.kind) {
    case 'route-status':
      return `I expected ${v.path} to respond with HTTP ${v.expectStatus ?? 200}${
        v.bodyContains && v.bodyContains.length > 0
          ? ' and contain ' + v.bodyContains.map((s) => `"${s}"`).join(', ')
          : ''
      }. ${r.observation}.`;
    case 'pb-row-exists':
      return `I expected a row in ${v.collection} matching ${v.filter}${
        v.assertFields
          ? ' with ' +
            Object.entries(v.assertFields)
              .map(([k, val]) => `${k}=${val}`)
              .join(', ')
          : ''
      }. ${r.observation}.`;
    case 'audit-event':
      return `I expected a recent ${v.eventType} audit event. ${r.observation}.`;
    case 'op-envelope':
      return `I expected a recent ${v.opKind} operation envelope (status=${v.status ?? 'ok'}). ${r.observation}.`;
    case 'iframe-element':
      return `I expected the page element "${v.selector}" to have ${v.read}=${v.equals ?? v.contains}. ${r.observation}.`;
  }
}
