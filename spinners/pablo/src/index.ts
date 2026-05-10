// Pablo Spinner — entrypoint loaded by the Weaver.
//
// Pablo is the Foundation's design-quality reviewer. He walks a
// rendered HTML surface, applies the cited library that lives in his
// Mission Lock, and returns strict-JSON findings. The Weaver-side
// dispatch (which calls the Quiet Loom with the Mission Lock as
// system prompt and parses the JSON defensively) lives in the Loom's
// `weaver.ts` for the bootstrap; the contract this module exports
// does not change when the Python Weaver lands.

import type { AuditEventType, SpinnerName, VaultURI } from '@webspinner-foundation/sdk';

export type Capability = 'review';

export type Severity = 'low' | 'medium' | 'high';
export type Category =
  | 'contrast'
  | 'typography'
  | 'composition'
  | 'brand'
  | 'interaction'
  | 'accessibility'
  | 'other';

export interface ReviewInput {
  /** Rendered HTML to walk. Truncated server-side at ~12K characters. */
  readonly html: string;
  /** What this surface is for, in patron-facing words. */
  readonly label?: string;
  /** Optional context — the Wizard's intent or the patron task. */
  readonly topic?: string;
}

export interface PabloFinding {
  readonly severity: Severity;
  readonly category: Category;
  readonly finding: string;
  readonly evidence: string;
  readonly fix: string;
  /** Library rule (e.g. "WCAG 2.2 SC 1.4.3") or "pablos-eye". */
  readonly source: string;
}

export interface ReviewOutput {
  readonly verdict: 'passes' | 'concerns' | 'fails';
  readonly verdict_text: string;
  readonly in_pablo_voice: string;
  readonly findings: readonly PabloFinding[];
}

export interface AuditEventDraft {
  readonly type: AuditEventType;
  readonly subject?: string;
  readonly reason: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface InvokeContext {
  readonly spinnerId: SpinnerName;
  readonly vault: Readonly<Record<string, string>>;
  readonly missionLock: string;
  resolveVault(uri: VaultURI): Promise<string>;
  emitAudit(event: AuditEventDraft): Promise<void>;
}

/**
 * The Weaver invokes this function. The implementation throws today;
 * the contract is fixed. Bootstrap dispatch in `weaver.ts` calls the
 * Quiet Loom directly using this Spinner's Mission Lock as the system
 * prompt and parses the strict JSON the model returns.
 */
export async function invoke(
  capability: Capability,
  input: unknown,
  context: InvokeContext,
): Promise<unknown> {
  void input;
  void context;
  throw new Error(
    `Pablo invocation pending Weaver runtime. Capability="${capability}". ` +
      `Bootstrap dispatch lives in the Loom's weaver.ts; this module's contract ` +
      `does not change when the Python Weaver lands.`,
  );
}
