/**
 * Weaver's Tension — types (v2).
 *
 * v2 mental model: the SI is the operator, the patron is the audience.
 * The player executes each step's scripted actions in the iframe (the
 * patron watches), then runs server-side verifications. On failure,
 * an onError remediation block runs; if remediation fails too, the
 * patron is paused at the failure for a manual decision.
 *
 * The patron's global controls are Pause / Resume / Stop. No per-step
 * gates. At the end of the run, the patron records an overall verdict.
 *
 * Scenarios live at `scenarios/<slug>.json`. Each scenario carries a
 * fixture block (slug, displayName, description, etc.) the SI uses for
 * test inputs — the patron doesn't pick test data; the test data is
 * part of the demonstration.
 */

import type { OperationActor } from '../operations.js';

export interface Scenario {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly version: 2;
  /**
   * Scenario-level constants substitutable as `{{fixture.<key>}}` in
   * actions, verifiers, and narration. Lets the scenario declare its
   * test inputs once.
   */
  readonly fixtures: Readonly<Record<string, string>>;
  readonly steps: readonly ScenarioStep[];
}

export interface ScenarioStep {
  readonly key: string;
  readonly title: string;
  /**
   * The SI's narration — what it's about to do. Manuscript voice.
   * Surfaces in the active-step panel AND as an auto-posted SI
   * chat message at the moment the step becomes active.
   */
  readonly narration: string;
  /**
   * Executable action program. The player runs these sequentially.
   * Between actions the player checks pause/stop flags.
   */
  readonly actions: readonly Action[];
  /**
   * Post-action verifications. Advisory in v1 — gating in v2:
   * if any verification fails AND onError isn't declared, the run
   * pauses at this step for the patron's decision.
   */
  readonly verifications?: readonly StepVerifier[];
  /**
   * Optional remediation. When verifications fail, the player runs
   * onError.actions, then re-verifies. Up to maxRetries cycles.
   */
  readonly onError?: OnErrorBlock;
}

export interface OnErrorBlock {
  /** SI narration when entering remediation. */
  readonly narration: string;
  /** Remediation actions. */
  readonly actions: readonly Action[];
  /** Number of (remediation → reverify) cycles before escalating. */
  readonly maxRetries?: number;
}

// ── Actions ──────────────────────────────────────────────────────

export type Action =
  | NavigateIframeAction
  | WaitForRouteAction
  | WaitForSelectorAction
  | FillAction
  | ClickAction
  | SubmitAction
  | SleepAction
  | NarrateAction;

export interface NavigateIframeAction {
  readonly kind: 'navigate-iframe';
  /** Path relative to the Loom origin. Supports placeholders. */
  readonly path: string;
  /** Optional: wait for the resolved URL to match this exact route after load. */
  readonly waitForRoute?: string;
  /** Timeout for the navigation in ms (default 8000). */
  readonly timeoutMs?: number;
}

export interface WaitForRouteAction {
  readonly kind: 'wait-for-route';
  readonly path: string;
  readonly timeoutMs?: number;
}

export interface WaitForSelectorAction {
  readonly kind: 'wait-for-selector';
  readonly selector: string;
  readonly timeoutMs?: number;
}

export interface FillAction {
  readonly kind: 'fill';
  readonly selector: string;
  readonly value: string;
}

export interface ClickAction {
  readonly kind: 'click';
  readonly selector: string;
  /** Optional: wait for the resolved URL to match this route post-click. */
  readonly waitForRoute?: string;
  readonly timeoutMs?: number;
}

export interface SubmitAction {
  readonly kind: 'submit';
  /** A form selector. The submit button inside is clicked. */
  readonly formSelector: string;
  /** Optional: wait for navigation to this path after submit. */
  readonly waitForRoute?: string;
  readonly timeoutMs?: number;
}

export interface SleepAction {
  readonly kind: 'sleep';
  /** Pause for this many ms — pure visual rhythm. */
  readonly ms: number;
}

export interface NarrateAction {
  readonly kind: 'narrate';
  /** Post a chat message from the SI inline mid-step. */
  readonly message: string;
}

// ── Verifiers ────────────────────────────────────────────────────

export type StepVerifier =
  | RouteStatusVerifier
  | PbRowExistsVerifier
  | AuditEventVerifier
  | OpEnvelopeVerifier
  | IframeElementVerifier;

export interface RouteStatusVerifier {
  readonly kind: 'route-status';
  readonly path: string;
  readonly expectStatus?: number;
  readonly bodyContains?: readonly string[];
}

export interface PbRowExistsVerifier {
  readonly kind: 'pb-row-exists';
  readonly collection: string;
  readonly filter: string;
  readonly assertFields?: Readonly<Record<string, string>>;
}

export interface AuditEventVerifier {
  readonly kind: 'audit-event';
  readonly eventType: string;
  readonly windowSec?: number;
  readonly subjectContains?: string;
}

export interface OpEnvelopeVerifier {
  readonly kind: 'op-envelope';
  readonly opKind: string;
  readonly status?: 'ok' | 'failed' | 'partial';
  readonly windowSec?: number;
}

/**
 * Client-side verifier — runs against the iframe DOM rather than
 * PB / route. Used to confirm form fields are populated, headings
 * say what we expect, etc. Executed by the driver, not the server.
 */
export interface IframeElementVerifier {
  readonly kind: 'iframe-element';
  readonly selector: string;
  /** What to read: 'textContent', 'value', or an attribute name. */
  readonly read: 'textContent' | 'value' | string;
  /** Expected value (placeholder-substituted). */
  readonly equals?: string;
  /** Expected substring (placeholder-substituted). */
  readonly contains?: string;
  readonly timeoutMs?: number;
}

// ── Run state ────────────────────────────────────────────────────

export type RunStatus = 'in-progress' | 'paused' | 'completed' | 'aborted' | 'failed';

export type StepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'remediated' | 'escalated';

export interface StepResult {
  readonly stepKey: string;
  readonly status: StepStatus;
  /** Last verifier evidence the player captured for this step. */
  readonly verifierEvidence?: Readonly<Record<string, unknown>>;
  readonly verifierObservation?: string;
  readonly attempts?: number;
  readonly recordedAt: string;
}

export interface RunMessage {
  readonly id: string;
  readonly ts: string;
  readonly authorKind: 'wizard' | 'webspinner' | 'si' | 'system';
  readonly authorId: string;
  readonly authorLabel?: string;
  readonly stepRef: string;
  readonly body: string;
}

export interface Run {
  readonly id: string;
  readonly runId: string;
  readonly scenarioSlug: string;
  readonly status: RunStatus;
  readonly opId: string;
  readonly currentStepIndex: number;
  readonly actor: OperationActor;
  readonly stepResults: readonly StepResult[];
  readonly messages: readonly RunMessage[];
  readonly answers: Readonly<Record<string, Record<string, unknown>>>;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly updatedAt: string;
}

// ── Verifier execution result ────────────────────────────────────

export interface VerifierResult {
  readonly ok: boolean;
  readonly observation: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}
