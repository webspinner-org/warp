/**
 * Orchestrator (v2) — server-side helpers the player route uses to
 * mutate run state + emit audit events. The patron-facing actor is
 * either a Wizard (superuser) or a Webspinner (user); audit events
 * always carry the actor's identity.
 *
 * One op envelope (kind `weavers-tension.run`) is written at end of
 * run. Audit events during the run carry the WT runId's opId as
 * correlation_id so the chain is recoverable even before the envelope
 * lands.
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
  patchRunStatus,
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

export async function startRun(
  ctx: OrchestratorContext,
  scenario: Scenario,
): Promise<
  { ok: true; value: { run: Run } } | { ok: false; error: { kind: string; detail: string } }
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

// ── Step result ─────────────────────────────────────────────────

export interface StepResultInput {
  readonly run: Run;
  readonly scenario: Scenario;
  readonly step: ScenarioStep;
  readonly stepIndex: number;
  readonly status: 'completed' | 'failed' | 'remediated' | 'escalated';
  readonly evidence?: Record<string, unknown>;
  readonly observation?: string;
  readonly attempts?: number;
}

export async function recordStep(
  ctx: OrchestratorContext,
  input: StepResultInput,
): Promise<{ ok: true; run: Run } | { ok: false; error: { kind: string; detail: string } }> {
  const result: StepResult = {
    stepKey: input.step.key,
    status: input.status,
    ...(input.evidence !== undefined ? { verifierEvidence: input.evidence } : {}),
    ...(input.observation !== undefined ? { verifierObservation: input.observation } : {}),
    ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
    recordedAt: new Date().toISOString(),
  };
  const advance = input.status === 'completed' || input.status === 'remediated';
  const updated = await recordStepResult(
    ctx.fetch,
    ctx.pbToken,
    input.run,
    result,
    undefined,
    advance,
  );
  if (!updated.ok) {
    return {
      ok: false,
      error: { kind: 'persist-step-failed', detail: `HTTP ${updated.status}: ${updated.body}` },
    };
  }
  const eventType =
    input.status === 'completed'
      ? ('wp.weavers-tension.step-completed' as const)
      : input.status === 'remediated'
        ? ('wp.weavers-tension.step-remediated' as const)
        : ('wp.weavers-tension.step-failed' as const);
  const data: Record<string, unknown> = {
    scenarioSlug: input.scenario.slug,
    runId: input.run.runId,
    stepIndex: input.stepIndex,
    stepKey: input.step.key,
  };
  if (input.evidence) data['evidence'] = input.evidence;
  if (input.status === 'failed' || input.status === 'escalated')
    data['reason'] = input.observation ?? 'step did not pass verification';
  if (input.status === 'remediated' && input.attempts !== undefined)
    data['attempts'] = input.attempts;

  await safeWriteAudit(ctx, {
    type: eventType,
    correlationId: input.run.opId,
    subject: input.step.key,
    reason: input.observation ?? `Step ${input.step.key} ${input.status}.`,
    data,
  });
  return { ok: true, run: updated.run };
}

// ── Messages ────────────────────────────────────────────────────

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
      error: {
        kind: 'persist-message-failed',
        detail: `HTTP ${updated.status}: ${updated.body}`,
      },
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

// ── Pause / Resume ──────────────────────────────────────────────

export async function pauseRun(
  ctx: OrchestratorContext,
  run: Run,
  scenario: Scenario,
): Promise<{ ok: true; run: Run } | { ok: false; error: { kind: string; detail: string } }> {
  const updated = await patchRunStatus(ctx.fetch, ctx.pbToken, run, 'paused');
  if (!updated.ok)
    return {
      ok: false,
      error: { kind: 'pause-failed', detail: `HTTP ${updated.status}: ${updated.body}` },
    };
  await safeWriteAudit(ctx, {
    type: 'wp.weavers-tension.paused',
    correlationId: run.opId,
    subject: scenario.slug,
    reason: `Run paused at step ${run.currentStepIndex}.`,
    data: {
      scenarioSlug: scenario.slug,
      runId: run.runId,
      atStepIndex: run.currentStepIndex,
    },
  });
  return { ok: true, run: updated.run };
}

export async function resumeRun(
  ctx: OrchestratorContext,
  run: Run,
  scenario: Scenario,
): Promise<{ ok: true; run: Run } | { ok: false; error: { kind: string; detail: string } }> {
  const updated = await patchRunStatus(ctx.fetch, ctx.pbToken, run, 'in-progress');
  if (!updated.ok)
    return {
      ok: false,
      error: { kind: 'resume-failed', detail: `HTTP ${updated.status}: ${updated.body}` },
    };
  await safeWriteAudit(ctx, {
    type: 'wp.weavers-tension.resumed',
    correlationId: run.opId,
    subject: scenario.slug,
    reason: `Run resumed at step ${run.currentStepIndex}.`,
    data: {
      scenarioSlug: scenario.slug,
      runId: run.runId,
      atStepIndex: run.currentStepIndex,
    },
  });
  return { ok: true, run: updated.run };
}

// ── End ─────────────────────────────────────────────────────────

export async function finishRun(
  ctx: OrchestratorContext,
  run: Run,
  scenario: Scenario,
): Promise<{ ok: true; run: Run } | { ok: false; error: { kind: string; detail: string } }> {
  const completed = await completeRun(ctx.fetch, ctx.pbToken, run);
  if (!completed.ok) {
    return {
      ok: false,
      error: {
        kind: 'complete-run-failed',
        detail: `HTTP ${completed.status}: ${completed.body}`,
      },
    };
  }
  const passed = completed.run.stepResults.filter(
    (r) => r.status === 'completed' || r.status === 'remediated',
  ).length;
  const failed = completed.run.stepResults.filter(
    (r) => r.status === 'failed' || r.status === 'escalated',
  ).length;
  const skipped = 0; // v2: no skip status
  const durationMs =
    new Date(completed.run.endedAt ?? new Date().toISOString()).getTime() -
    new Date(completed.run.startedAt).getTime();

  await safeWriteAudit(ctx, {
    type: 'wp.weavers-tension.completed',
    correlationId: run.opId,
    subject: scenario.slug,
    reason: `Weaver's Tension run completed: ${passed} passed, ${failed} failed, ${skipped} skipped.`,
    data: {
      scenarioSlug: scenario.slug,
      runId: run.runId,
      approvedCount: passed,
      flaggedCount: failed,
      skippedCount: skipped,
      durationMs,
    },
  });

  await safeWriteOpEnvelope(ctx, {
    opId: run.opId,
    kind: 'weavers-tension.run',
    status: failed > 0 ? 'partial' : 'ok',
    startedAt: run.startedAt,
    endedAt: completed.run.endedAt ?? new Date().toISOString(),
    input: { scenarioSlug: scenario.slug, runId: run.runId },
    output: { passed, failed, skipped, durationMs },
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
      error: {
        kind: 'abort-run-failed',
        detail: `HTTP ${aborted.status}: ${aborted.body}`,
      },
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
