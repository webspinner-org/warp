// Bootstrap Spinner — entrypoint loaded by the Weaver.
//
// This module exports the invocation contract the Weaver honours. The
// Weaver-side runtime that resolves vault references, retrieves WRAG
// context, calls Anthropic with the mission lock, verifies grounding,
// and records audit events is open work — see OPEN_QUESTIONS.md.
// When the runtime lands, this entrypoint becomes the live implementation
// without changes to the manifest or the mission lock.

import type { AuditEventType, SpinnerName, VaultURI } from '@webspinner-foundation/sdk';

export type Capability = 'consult' | 'audit' | 'record' | 'surface';

/** A passage retrieved by WRAG and offered to the Spinner as ground. */
export interface RetrievedPassage {
  /** Stable identifier — file path + section anchor, or manuscript chapter + paragraph. */
  readonly source: string;
  /** Verbatim retrieved text. */
  readonly content: string;
  /** Re-ranker score in [0, 1]. */
  readonly score: number;
}

/** Audit event the Spinner asks the Weaver to record. */
export interface AuditEventDraft {
  readonly type: AuditEventType;
  readonly subject?: string;
  /** One-sentence justification. Required per Operating Principle §17.2. */
  readonly reason: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Context the Weaver assembles for each invocation.
 *
 * Vault values are resolved from `vault://` URIs declared in the manifest.
 * Retrieval is sensitivity-aware: scopes the Cell has not authorized for
 * federation are not crossed.
 */
export interface InvokeContext {
  readonly spinnerId: SpinnerName;
  readonly vault: Readonly<Record<string, string>>;
  /** The Spinner's mission lock, loaded from `mission-lock.md`. */
  readonly missionLock: string;
  retrieve(query: string, scope: readonly string[]): Promise<readonly RetrievedPassage[]>;
  resolveVault(uri: VaultURI): Promise<string>;
  emitAudit(event: AuditEventDraft): Promise<void>;
}

export interface ConsultInput {
  readonly question: string;
}
export interface ConsultOutput {
  readonly answer: string;
  readonly citations: readonly string[];
}

export interface AuditInput {
  readonly subject: string;
  readonly kind: 'file' | 'text';
}
export interface AuditOutput {
  readonly drift: readonly {
    readonly severity: 'info' | 'warning' | 'error';
    readonly rule: string;
    readonly evidence: string;
    readonly suggestion: string;
  }[];
}

export interface RecordInput {
  readonly title: string;
  readonly body: string;
  readonly supersedes?: string;
}
export interface RecordOutput {
  readonly entry: string;
}

export interface SurfaceOutput {
  readonly threads: readonly {
    readonly kind: 'uncommitted' | 'open-question' | 'spec-pending' | 'todo';
    readonly subject: string;
    readonly ageDays: number;
  }[];
}

/**
 * The Weaver invokes this function with the named capability and its
 * typed input. The implementation throws today; the contract is fixed.
 */
export async function invoke(
  capability: Capability,
  input: unknown,
  context: InvokeContext,
): Promise<unknown> {
  // Voiding parameters until the runtime lands; intentional.
  void input;
  void context;
  throw new Error(
    `Bootstrap Spinner invocation pending Weaver runtime. ` +
      `Capability="${capability}". The Weaver-side pipeline that resolves ` +
      `vault references, retrieves WRAG passages, calls Anthropic with the ` +
      `mission lock, verifies grounding, and records audit events is open ` +
      `work — see DECISIONS.md and OPEN_QUESTIONS.md. The contract this ` +
      `module exports does not change when the runtime lands.`,
  );
}
