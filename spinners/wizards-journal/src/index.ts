// Wizard's Journal Spinner — entrypoint loaded by the Weaver.

import type { AuditEventType, SpinnerName, VaultURI } from '@webspinner-foundation/sdk';

export type Capability = 'record' | 'recall' | 'bootstrap';

export type EntryKind = 'action' | 'decision' | 'problem' | 'learning' | 'note';

export interface RecordInput {
  readonly kind: EntryKind;
  readonly title: string;
  readonly body: string;
  readonly tags?: readonly string[];
  readonly relatedSpinners?: readonly string[];
  readonly public?: boolean;
}

export interface RecordOutput {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: EntryKind;
  readonly title: string;
}

export interface RecallInput {
  readonly query: string;
  readonly since?: string;
  readonly limit?: number;
  readonly kind?: EntryKind;
  readonly tag?: string;
}

export interface RecalledEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly score: number;
}

export interface RecallOutput {
  readonly entries: readonly RecalledEntry[];
  readonly totalScanned: number;
}

export interface BootstrapInput {
  readonly scope?: string;
  readonly horizonDays?: number;
}

export interface BootstrapOutput {
  readonly context: string;
  readonly stats: {
    readonly totalEntries: number;
    readonly recentEntries: number;
    readonly horizonDays: number;
  };
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

export async function invoke(
  capability: Capability,
  input: unknown,
  context: InvokeContext,
): Promise<unknown> {
  void input;
  void context;
  throw new Error(
    `Wizard's Journal invocation pending Weaver runtime. Capability="${capability}". ` +
      `Bootstrap dispatch lives in the Loom's weaver.ts; this module's contract ` +
      `does not change when the Python Weaver lands.`,
  );
}
