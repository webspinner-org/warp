/**
 * Orchestrator — ties together runs persistence, audit emission, and
 * (at end-of-run) op envelope finalization.
 *
 * Every Weaver's Tension run gets one op envelope of kind
 * `weavers-tension.run`. The envelope is written at end-of-run (the
 * existing `writeOperation` is one-shot); during the run, the opId is
 * generated up-front and used as `correlation_id` on every audit
 * event so the event chain is recoverable even before the envelope
 * lands.
 *
 * Audit events form a family of seven:
 *   wp.weavers-tension.started      — emitted at start
 *   wp.weavers-tension.step-approved   per Approve gate
 *   wp.weavers-tension.step-flagged    per Flag gate
 *   wp.weavers-tension.step-skipped    per Skip gate
 *   wp.weavers-tension.message         per chat message
 *   wp.weavers-tension.completed       at clean end
 *   wp.weavers-tension.aborted         at abort
 */

import { randomUUID } from 'node:crypto';
import { ensureAuditCollection, writeAuditEvent } from '../audit.js';
import { operationActorToAuditActor, writeOperation, type OperationActor } from '../operations.js';
import {
  appendMessage,
  completeRun,
  createRun,
  ensureRunsCollection,
  abortRun as persistAbortRun,
  makeMessageId,
  recordStepResult,
} from './runs.js';
import type { Run, RunMessage, Scenario, ScenarioStep, StepResult } from './types.js';

const SOURCE = 'wp://loom.cell.local/weavers-tension';
const OCSF_API_ACTIVITY = 6003;

export interface OrchestratorContext {
  readonly fetch: typeof fetch;
  readonly pbToken: string;
  readonly actor: OperationActor;
}

// ── Start ────────────────────────────────────────────────────────

export interface StartRunOutput {
  readonly run: Run;
}

export async function startRun(
  ctx: OrchestratorContext,
  scenario: Scenario,
): Promise<
  { ok: true; value: StartRunOutput } | { ok: false; error: { kind: string; detail: string } }
> {
  const ensureRuns = await ensureRunsCollection(ctx.fetch, ctx.pbToken);
  if (!ensureRuns.ok) {
    return {
      ok: false,
      error: {
        kind: 'ensure-runs-failed',
        detail: `HTTP ${ensureRuns.status}: ${ensureRuns.body}`,
      },
    };
  }
  await ensureAuditCollection(ctx.fetch, ctx.pbToken);

  const opId = randomUUID();
  const created = await createRun(ctx.fetch, ctx.pbToken, {
    scenarioSlug: scenario.slug,
    opId,
    actor: ctx.actor,
  });
  if (!created.ok) {
    return {
      ok: false,
      error: { kind: 'create-run-failed', detail: `HTTP ${created.status}: ${created.body}` },
    };
  }
  await safeWriteAudit(ctx, {
    type: 'wp.weavers-tension.started',
    correlationId: opId,
    subject: scenario.slug,
    reason: `Weaver's Tension run started for scenario "${scenario.slug}".`,
    data: {
      scenarioSlug: scenario.slug,
      runId: created.run.runId,
      stepCount: scenario.steps.length,
    },
  });
  return { ok: true, value: { run: created.run } };
}

// ── Gates ────────────────────────────────────────────────────────

export interface GateInput {
  readonly run: Run;
  readonly scenario: Scenario;
  readonly step: ScenarioStep;
  readonly stepIndex: number;
  readonly verdict: 'approved' | 'flagged' | 'skipped';
  readonly comment?: string;
  readonly reason?: string;
  readonly verifierEvidence?: Record<string, unknown>;
  readonly verifierObservation?: string;
  readonly newAnswers?: Record<string, Record<string, unknown>>;
}

export async function gateStep(
  ctx: OrchestratorContext,
  input: GateInput,
): Promise<{ ok: true; run: Run } | { ok: false; error: { kind: string; detail: string } }> {
  const result: StepResult = {
    stepKey: input.step.key,
    status: input.verdict,
    ...(input.verifierEvidence !== undefined ? { verifierEvidence: input.verifierEvidence } : {}),
    ...(input.verifierObservation !== undefined
      ? { verifierObservation: input.verifierObservation }
      : {}),
    ...(input.comment !== undefined && input.comment.length > 0 ? { comment: input.comment } : {}),
    ...(input.reason !== undefined && input.reason.length > 0 ? { reason: input.reason } : {}),
    recordedAt: new Date().toISOString(),
  };
  const updated = await recordStepResult(
    ctx.fetch,
    ctx.pbToken,
    input.run,
    result,
    input.newAnswers,
    /* advance */ true,
  );
  if (!updated.ok) {
    return {
      ok: false,
      error: { kind: 'persist-step-failed', detail: `HTTP ${updated.status}: ${updated.body}` },
    };
  }
  const eventType =
    input.verdict === 'approved'
      ? ('wp.weavers-tension.step-approved' as const)
      : input.verdict === 'flagged'
        ? ('wp.weavers-tension.step-flagged' as const)
        : ('wp.weavers-tension.step-skipped' as const);
  const baseData = {
    scenarioSlug: input.run.scenarioSlug,
    runId: input.run.runId,
    stepIndex: input.stepIndex,
    stepKey: input.step.key,
  };
  const eventData: Record<string, unknown> = { ...baseData };
  if (input.verdict === 'approved') {
    if (input.verifierObservation) eventData['observation'] = input.verifierObservation;
    if (input.verifierEvidence) eventData['verifierEvidence'] = input.verifierEvidence;
  } else if (input.verdict === 'flagged') {
    eventData['reason'] = input.reason ?? input.comment ?? 'flagged without reason';
    if (input.verifierEvidence) eventData['verifierEvidence'] = input.verifierEvidence;
  } else {
    if (input.reason) eventData['reason'] = input.reason;
  }
  await safeWriteAudit(ctx, {
    type: eventType,
    correlationId: input.run.opId,
    subject: input.step.key,
    reason: input.comment ?? input.reason ?? `Step ${input.step.key} ${input.verdict}.`,
    data: eventData,
  });
  return { ok: true, run: updated.run };
}

// ── Messages ─────────────────────────────────────────────────────

export interface PostMessageInput {
  readonly run: Run;
  readonly scenario: Scenario;
  readonly authorKind: RunMessage['authorKind'];
  readonly authorId: string;
  readonly authorLabel?: string;
  readonly stepKey: string;
  readonly body: string;
}

export async function postMessage(
  ctx: OrchestratorContext,
  input: PostMessageInput,
): Promise<
  | { ok: true; run: Run; message: RunMessage }
  | { ok: false; error: { kind: string; detail: string } }
> {
  const message: RunMessage = {
    id: makeMessageId(),
    ts: new Date().toISOString(),
    authorKind: input.authorKind,
    authorId: input.authorId,
    ...(input.authorLabel !== undefined ? { authorLabel: input.authorLabel } : {}),
    stepRef: input.stepKey,
    body: input.body,
  };
  const updated = await appendMessage(ctx.fetch, ctx.pbToken, input.run, message);
  if (!updated.ok) {
    return {
      ok: false,
      error: { kind: 'persist-message-failed', detail: `HTTP ${updated.status}: ${updated.body}` },
    };
  }
  await safeWriteAudit(ctx, {
    type: 'wp.weavers-tension.message',
    correlationId: input.run.opId,
    subject: input.stepKey,
    reason: `Message from ${input.authorKind} during step "${input.stepKey}".`,
    data: {
      scenarioSlug: input.run.scenarioSlug,
      runId: input.run.runId,
      stepIndex: input.run.currentStepIndex,
      authorKind: input.authorKind,
      body: input.body,
    },
  });
  return { ok: true, run: updated.run, message };
}

// ── End ──────────────────────────────────────────────────────────

export async function finishRun(
  ctx: OrchestratorContext,
  run: Run,
  scenario: Scenario,
): Promise<{ ok: true; run: Run } | { ok: false; error: { kind: string; detail: string } }> {
  const completed = await completeRun(ctx.fetch, ctx.pbToken, run);
  if (!completed.ok) {
    return {
      ok: false,
      error: { kind: 'complete-run-failed', detail: `HTTP ${completed.status}: ${completed.body}` },
    };
  }
  const approvedCount = completed.run.stepResults.filter((r) => r.status === 'approved').length;
  const flaggedCount = completed.run.stepResults.filter((r) => r.status === 'flagged').length;
  const skippedCount = completed.run.stepResults.filter((r) => r.status === 'skipped').length;
  const durationMs =
    new Date(completed.run.endedAt ?? new Date().toISOString()).getTime() -
    new Date(completed.run.startedAt).getTime();

  await safeWriteAudit(ctx, {
    type: 'wp.weavers-tension.completed',
    correlationId: run.opId,
    subject: scenario.slug,
    reason: `Weaver's Tension run completed: ${approvedCount} approved, ${flaggedCount} flagged, ${skippedCount} skipped.`,
    data: {
      scenarioSlug: scenario.slug,
      runId: run.runId,
      approvedCount,
      flaggedCount,
      skippedCount,
      durationMs,
    },
  });

  await safeWriteOpEnvelope(ctx, {
    opId: run.opId,
    kind: 'weavers-tension.run',
    status: flaggedCount > 0 ? 'partial' : 'ok',
    startedAt: run.startedAt,
    endedAt: completed.run.endedAt ?? new Date().toISOString(),
    input: { scenarioSlug: scenario.slug, runId: run.runId },
    output: { approvedCount, flaggedCount, skippedCount, durationMs },
  });

  return { ok: true, run: completed.run };
}

export interface AbortInput {
  readonly run: Run;
  readonly scenario: Scenario;
  readonly atStepIndex: number;
  readonly reason: string;
}

export async function abortRun(
  ctx: OrchestratorContext,
  input: AbortInput,
): Promise<{ ok: true; run: Run } | { ok: false; error: { kind: string; detail: string } }> {
  const aborted = await persistAbortRun(ctx.fetch, ctx.pbToken, input.run);
  if (!aborted.ok) {
    return {
      ok: false,
      error: { kind: 'abort-run-failed', detail: `HTTP ${aborted.status}: ${aborted.body}` },
    };
  }
  await safeWriteAudit(ctx, {
    type: 'wp.weavers-tension.aborted',
    correlationId: input.run.opId,
    subject: input.scenario.slug,
    reason: input.reason,
    data: {
      scenarioSlug: input.scenario.slug,
      runId: input.run.runId,
      atStepIndex: input.atStepIndex,
      reason: input.reason,
    },
  });
  await safeWriteOpEnvelope(ctx, {
    opId: input.run.opId,
    kind: 'weavers-tension.run',
    status: 'failed',
    startedAt: input.run.startedAt,
    endedAt: aborted.run.endedAt ?? new Date().toISOString(),
    input: { scenarioSlug: input.scenario.slug, runId: input.run.runId },
    error: { kind: 'aborted', message: input.reason },
  });
  return { ok: true, run: aborted.run };
}

// ── helpers ──────────────────────────────────────────────────────

interface AuditWriteShape {
  readonly type: import('@webspinner-foundation/sdk').AuditEventType;
  readonly correlationId: string;
  readonly subject: string;
  readonly reason: string;
  readonly data: Record<string, unknown>;
}

async function safeWriteAudit(ctx: OrchestratorContext, w: AuditWriteShape): Promise<void> {
  try {
    await writeAuditEvent(ctx.fetch, ctx.pbToken, {
      type: w.type,
      source: SOURCE,
      actor: operationActorToAuditActor(ctx.actor),
      result: 'success',
      reason: w.reason,
      subject: w.subject,
      correlationId: w.correlationId,
      ocsfClass: OCSF_API_ACTIVITY,
      data: w.data,
    });
  } catch (err) {
    console.error(`[weavers-tension] audit write failed: ${(err as Error).message}`);
  }
}

interface OpEnvelopeShape {
  readonly opId: string;
  readonly kind: 'weavers-tension.run';
  readonly status: 'ok' | 'failed' | 'partial';
  readonly startedAt: string;
  readonly endedAt: string;
  readonly input: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly error?: { readonly kind: string; readonly message: string };
}

async function safeWriteOpEnvelope(
  ctx: OrchestratorContext,
  shape: OpEnvelopeShape,
): Promise<void> {
  try {
    // Note: writeOperation generates its own opId; the Weaver's Tension
    // opId we used as correlation_id won't match the envelope's op_id.
    // This is a known v1 limitation — the correlation works at the
    // audit-event level (events carry the WT opId), but the envelope
    // has its own. We deliberately don't extend writeOperation here;
    // the audit chain is the source of truth and is intact.
    await writeOperation(ctx.fetch, ctx.pbToken, {
      kind: shape.kind,
      status: shape.status,
      startedAt: shape.startedAt,
      endedAt: shape.endedAt,
      actor: ctx.actor,
      input: shape.input,
      ...(shape.output !== undefined ? { output: shape.output } : {}),
      ...(shape.error !== undefined ? { error: shape.error } : {}),
    });
  } catch (err) {
    console.error(`[weavers-tension] op envelope write failed: ${(err as Error).message}`);
  }
}
