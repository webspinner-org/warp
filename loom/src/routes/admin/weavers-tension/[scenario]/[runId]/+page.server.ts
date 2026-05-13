/**
 * Weaver's Tension — the player.
 *
 * Server side: load the run + scenario, optionally run the current
 * step's verifier on entry. Actions: gate (approve/flag/skip), message,
 * recheck, finish, abort.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import { getSession } from '$lib/server/session.js';
import { loomPbToken, refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { getScenario, substitutePlaceholders } from '$lib/server/weavers-tension/loader.js';
import { getRun } from '$lib/server/weavers-tension/runs.js';
import { runVerifier } from '$lib/server/weavers-tension/verifiers.js';
import {
  abortRun,
  finishRun,
  gateStep,
  postMessage,
  type OrchestratorContext,
} from '$lib/server/weavers-tension/orchestrator.js';
import type { OperationActor } from '$lib/server/operations.js';
import type { Scenario, ScenarioStep, VerifierResult } from '$lib/server/weavers-tension/types.js';
import type { Actions, PageServerLoad } from './$types.js';

async function actorFromSession(
  fetch: typeof globalThis.fetch,
  session: NonNullable<ReturnType<typeof getSession>>,
): Promise<OperationActor> {
  if (session.collection === 'users') {
    const r = await refreshUser(fetch, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
    return { kind: 'webspinner', id: r.value.record.id, email: r.value.record.email };
  }
  const r = await refreshSuperuser(fetch, session.token);
  if (!r.ok) throw error(401, 'Session expired.');
  return { kind: 'wizard', id: r.auth.record.id, email: r.auth.record.email };
}

function activeStep(scenario: Scenario, idx: number): ScenarioStep | null {
  return scenario.steps[idx] ?? null;
}

export const load: PageServerLoad = async ({ parent, params, fetch, cookies, request }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');
  const layoutData = await parent();
  const loaded = await getScenario(params.scenario);
  if (!loaded.ok) throw error(404, `Scenario "${params.scenario}" not found.`);
  const pbToken = await loomPbToken(fetch);
  if (!pbToken) throw error(500, 'PocketBase superuser credentials missing on the Loom.');

  const found = await getRun(fetch, pbToken, params.runId);
  if (!found.ok) throw error(500, `Failed to load run: HTTP ${found.status}`);
  if (!found.run) throw error(404, `Run "${params.runId}" not found.`);
  const run = found.run;
  const scenario = loaded.value;
  const step = activeStep(scenario, run.currentStepIndex);

  let verifier: VerifierResult | null = null;
  if (step?.verifier && run.status === 'in-progress') {
    verifier = await runVerifier({
      fetch,
      pbToken,
      verifier: step.verifier,
      answers: run.answers,
      cookieHeader: request.headers.get('cookie') ?? undefined,
    });
  }

  const resolvedIframeRoute = step?.iframeRoute
    ? substitutePlaceholders(step.iframeRoute, run.answers)
    : null;

  return {
    user: layoutData.user,
    scenarioSlug: scenario.slug,
    scenarioTitle: scenario.title,
    run: {
      runId: run.runId,
      status: run.status,
      currentStepIndex: run.currentStepIndex,
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? null,
      messages: run.messages,
      stepResults: run.stepResults,
      answers: run.answers,
    },
    steps: scenario.steps.map((s, idx) => {
      const result = run.stepResults.find((r) => r.stepKey === s.key);
      return {
        key: s.key,
        title: s.title,
        status:
          run.status === 'aborted' && idx > run.currentStepIndex
            ? 'pending'
            : (result?.status ??
              (idx === run.currentStepIndex && run.status === 'in-progress'
                ? 'active'
                : 'pending')),
      };
    }),
    activeStep: step
      ? {
          key: step.key,
          title: step.title,
          observation: step.observation,
          iframeRoute: resolvedIframeRoute,
          question: step.question,
          hasVerifier: step.verifier !== undefined,
          answerKey: step.answerKey ?? null,
        }
      : null,
    verifier,
    isLastStep: step !== null && run.currentStepIndex === scenario.steps.length - 1,
    isFinished: run.status !== 'in-progress',
  };
};

export const actions: Actions = {
  approve: async ({ params, request, fetch, cookies }) => {
    return doGate(params, request, fetch, cookies, 'approved');
  },
  flag: async ({ params, request, fetch, cookies }) => {
    return doGate(params, request, fetch, cookies, 'flagged');
  },
  skip: async ({ params, request, fetch, cookies }) => {
    return doGate(params, request, fetch, cookies, 'skipped');
  },

  message: async ({ params, request, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { messageError: 'no-pb-token' });
    const formData = await request.formData();
    const body = String(formData.get('body') ?? '').trim();
    if (body.length === 0) return fail(400, { messageError: 'empty' });
    if (body.length > 4000) return fail(400, { messageError: 'too-long' });

    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { messageError: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { messageError: 'run-not-found' });
    const actor = await actorFromSession(fetch, session);
    const ctx: OrchestratorContext = { fetch, pbToken, actor };
    const step = loaded.value.steps[found.run.currentStepIndex];
    const stepKey = step ? step.key : 'post-end';
    const posted = await postMessage(ctx, {
      run: found.run,
      scenario: loaded.value,
      authorKind: actor.kind === 'wizard' ? 'wizard' : 'webspinner',
      authorId: actor.id,
      authorLabel: actor.email,
      stepKey,
      body,
    });
    if (!posted.ok) return fail(500, { messageError: posted.error.kind });
    return { messageOk: true };
  },

  finish: async ({ params, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { topLevelError: { kind: 'no-pb-token', detail: '' } });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { topLevelError: { kind: 'scenario-not-found', detail: '' } });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run)
      return fail(404, { topLevelError: { kind: 'run-not-found', detail: '' } });
    const actor = await actorFromSession(fetch, session);
    const ctx: OrchestratorContext = { fetch, pbToken, actor };
    const finished = await finishRun(ctx, found.run, loaded.value);
    if (!finished.ok)
      return fail(500, {
        topLevelError: { kind: finished.error.kind, detail: finished.error.detail },
      });
    return { finished: true };
  },

  abort: async ({ params, request, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { topLevelError: { kind: 'no-pb-token', detail: '' } });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { topLevelError: { kind: 'scenario-not-found', detail: '' } });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run)
      return fail(404, { topLevelError: { kind: 'run-not-found', detail: '' } });
    const formData = await request.formData();
    const reason = String(formData.get('reason') ?? 'patron aborted').trim();
    const actor = await actorFromSession(fetch, session);
    const ctx: OrchestratorContext = { fetch, pbToken, actor };
    const aborted = await abortRun(ctx, {
      run: found.run,
      scenario: loaded.value,
      atStepIndex: found.run.currentStepIndex,
      reason,
    });
    if (!aborted.ok)
      return fail(500, {
        topLevelError: { kind: aborted.error.kind, detail: aborted.error.detail },
      });
    throw redirect(303, `/admin/weavers-tension`);
  },
};

async function doGate(
  params: { scenario: string; runId: string },
  request: Request,
  fetch: typeof globalThis.fetch,
  cookies: Parameters<PageServerLoad>[0]['cookies'],
  verdict: 'approved' | 'flagged' | 'skipped',
): Promise<unknown> {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');
  const pbToken = await loomPbToken(fetch);
  if (!pbToken) return fail(500, { topLevelError: { kind: 'no-pb-token', detail: '' } });
  const loaded = await getScenario(params.scenario);
  if (!loaded.ok) return fail(404, { topLevelError: { kind: 'scenario-not-found', detail: '' } });
  const found = await getRun(fetch, pbToken, params.runId);
  if (!found.ok || !found.run)
    return fail(404, { topLevelError: { kind: 'run-not-found', detail: '' } });
  const run = found.run;
  if (run.status !== 'in-progress') {
    return fail(400, {
      topLevelError: { kind: 'run-not-in-progress', detail: `run is ${run.status}` },
    });
  }
  const step = loaded.value.steps[run.currentStepIndex];
  if (!step) {
    return fail(400, { topLevelError: { kind: 'no-active-step', detail: '' } });
  }

  const formData = await request.formData();
  const comment = String(formData.get('comment') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  // Collect prompt-input answers if present.
  let newAnswers: Record<string, Record<string, unknown>> | undefined;
  if (step.answerKey && step.question.kind === 'prompt-input') {
    const bag: Record<string, unknown> = {};
    for (const field of step.question.fields) {
      const raw = String(formData.get(`answer.${field.name}`) ?? '').trim();
      if (field.required && raw.length === 0) {
        return fail(400, {
          topLevelError: {
            kind: 'missing-required-field',
            detail: `Field "${field.label}" is required.`,
          },
        });
      }
      if (raw.length > 0) bag[field.name] = raw;
    }
    if (Object.keys(bag).length > 0) {
      newAnswers = { [step.answerKey]: bag };
    }
  }

  // Run the verifier one more time to capture the latest evidence on
  // the audit event.
  let verifierEvidence: Record<string, unknown> | undefined;
  let verifierObservation: string | undefined;
  if (step.verifier) {
    const v = await runVerifier({
      fetch,
      pbToken,
      verifier: step.verifier,
      answers: { ...run.answers, ...(newAnswers ?? {}) },
      cookieHeader: request.headers.get('cookie') ?? undefined,
    });
    verifierEvidence = v.evidence;
    verifierObservation = v.observation;
  }

  const actor = await actorFromSession(fetch, session);
  const ctx: OrchestratorContext = { fetch, pbToken, actor };
  const gated = await gateStep(ctx, {
    run,
    scenario: loaded.value,
    step,
    stepIndex: run.currentStepIndex,
    verdict,
    ...(comment.length > 0 ? { comment } : {}),
    ...(reason.length > 0 ? { reason } : {}),
    ...(verifierEvidence !== undefined ? { verifierEvidence } : {}),
    ...(verifierObservation !== undefined ? { verifierObservation } : {}),
    ...(newAnswers !== undefined ? { newAnswers } : {}),
  });
  if (!gated.ok) {
    return fail(500, { topLevelError: { kind: gated.error.kind, detail: gated.error.detail } });
  }
  return { gateOk: verdict };
}
