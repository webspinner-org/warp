/**
 * Weaver's Tension — types.
 *
 * A *scenario* is a JSON file at `scenarios/<slug>.json`. The player
 * consumes it and walks the patron through a gated, narrated sequence
 * of steps. Each step pairs a pre-authored observation with a question
 * (for the patron to answer) and, optionally, a server-side verifier
 * (to confirm the artifact actually exists on the Loom).
 *
 * A *run* is one walkthrough of a scenario by a specific actor. Runs
 * persist to `wp_weavers_tension_runs`; the player resumes from the
 * stored state. The op envelope (kind `weavers-tension.run`) is the
 * audit anchor — every gate and every chat message correlates to the
 * run's `opId`.
 *
 * The name is canonical (`DECISIONS.md` 2026-05-12). Tension is the
 * controlled pull on the warp threads — what makes the weave hold its
 * pattern. The Weaver's Tension is the just-right discipline of the
 * conversation between SI and patron.
 */

import type { OperationActor } from '../operations.js';

/**
 * A single step in a scenario. The shape is the same for every step;
 * what differs is the `question` and `verifier` blocks the scenario
 * author declares.
 */
export interface ScenarioStep {
  /** Stable identifier within the scenario (e.g. "open-admin"). */
  readonly key: string;
  /** Display title in the right column. */
  readonly title: string;
  /**
   * The SI's pre-authored observation prose. Manuscript voice — em
   * dashes welcome. Rendered in serif. Visible the moment the step
   * becomes active.
   */
  readonly observation: string;
  /**
   * If present, the iframe will navigate here at the start of the
   * step. Relative to the Loom origin (e.g. `/admin/spinners`).
   * Absent on steps that don't have a single canonical anchor route.
   */
  readonly iframeRoute?: string;
  /**
   * Optional server-side check the player runs when entering the step.
   * The verifier returns `{ ok, observation, evidence }` and the
   * evidence is rendered alongside the SI's observation as JSON.
   */
  readonly verifier?: StepVerifier;
  /**
   * What the patron is asked. Determines the controls in the right
   * column. Every step has a question — even if it's just `confirm`
   * (a single Approve button).
   */
  readonly question: StepQuestion;
  /**
   * If declared, the run state records the patron's answer under this
   * key, available to later steps' verifiers and observations.
   * Example: a slug typed in step 6 is used by step 7's verifier to
   * confirm the skein row got written for that slug.
   */
  readonly answerKey?: string;
}

export type StepVerifier =
  | RouteStatusVerifier
  | PbRowExistsVerifier
  | AuditEventVerifier
  | OpEnvelopeVerifier;

export interface RouteStatusVerifier {
  readonly kind: 'route-status';
  /** Path relative to the Loom origin (e.g. `/admin/spinners`). */
  readonly path: string;
  /** Expected HTTP status (default 200). */
  readonly expectStatus?: number;
  /**
   * Optional substring assertions against the response body. All must
   * appear or the verifier fails.
   */
  readonly bodyContains?: readonly string[];
}

export interface PbRowExistsVerifier {
  readonly kind: 'pb-row-exists';
  readonly collection: string;
  /**
   * PocketBase filter expression. Placeholders `{{answer.<key>}}` are
   * substituted with the patron's prior answers.
   */
  readonly filter: string;
  /**
   * Optional field assertions: each entry must match exactly against
   * the row's field value. Placeholders supported.
   */
  readonly assertFields?: Record<string, string>;
}

export interface AuditEventVerifier {
  readonly kind: 'audit-event';
  readonly eventType: string;
  /** Look back this many seconds for a matching event (default 600). */
  readonly windowSec?: number;
  /** Optional subject substring filter. */
  readonly subjectContains?: string;
}

export interface OpEnvelopeVerifier {
  readonly kind: 'op-envelope';
  /** Required op kind (e.g. `spinner.install`). */
  readonly opKind: string;
  /** Required final status (default `ok`). */
  readonly status?: 'ok' | 'failed' | 'partial';
  /** Look back this many seconds (default 600). */
  readonly windowSec?: number;
}

export type StepQuestion =
  | ConfirmQuestion
  | ChoiceQuestion
  | ProseQuestion
  | VerifyAndCommentQuestion
  | PromptInputQuestion;

export interface ConfirmQuestion {
  readonly kind: 'confirm';
  /** Button label override (default "Approve"). */
  readonly approveLabel?: string;
}

export interface ChoiceQuestion {
  readonly kind: 'choice';
  readonly prompt: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** If true, multiple options can be selected (checkboxes vs radios). */
  readonly multi?: boolean;
}

export interface ProseQuestion {
  readonly kind: 'prose';
  readonly prompt: string;
  readonly placeholder?: string;
}

export interface VerifyAndCommentQuestion {
  readonly kind: 'verify+comment';
  readonly prompt: string;
  readonly commentPlaceholder?: string;
}

export interface PromptInputQuestion {
  readonly kind: 'prompt-input';
  readonly prompt: string;
  readonly fields: readonly {
    readonly name: string;
    readonly label: string;
    readonly placeholder?: string;
    readonly required?: boolean;
  }[];
}

export interface Scenario {
  /** Slug — filename without `.json`. */
  readonly slug: string;
  /** Human-readable title for the index. */
  readonly title: string;
  /** One-paragraph summary for the index. */
  readonly summary: string;
  /** Schema version (1 = bootstrap). */
  readonly version: 1;
  readonly steps: readonly ScenarioStep[];
}

// ── Run state ────────────────────────────────────────────────────

export type RunStatus = 'in-progress' | 'completed' | 'aborted';

export type StepStatus = 'pending' | 'active' | 'approved' | 'flagged' | 'skipped';

export interface StepResult {
  readonly stepKey: string;
  readonly status: StepStatus;
  readonly verifierEvidence?: Record<string, unknown>;
  readonly verifierObservation?: string;
  readonly answer?: Record<string, unknown>;
  readonly comment?: string;
  readonly reason?: string;
  readonly recordedAt: string;
}

export interface RunMessage {
  readonly id: string;
  readonly ts: string;
  readonly authorKind: 'wizard' | 'webspinner' | 'si' | 'system';
  readonly authorId: string;
  readonly authorLabel?: string;
  /** Step key the message was authored under (or 'pre-start'/'post-end'). */
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
  /** Patron-supplied data accumulated across steps, keyed by ScenarioStep.answerKey. */
  readonly answers: Record<string, Record<string, unknown>>;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly updatedAt: string;
}

// ── Verifier execution result ────────────────────────────────────

export interface VerifierResult {
  readonly ok: boolean;
  /** One-line summary suitable for the right column. */
  readonly observation: string;
  /** Raw evidence for the JSON panel under the observation. */
  readonly evidence: Record<string, unknown>;
}
