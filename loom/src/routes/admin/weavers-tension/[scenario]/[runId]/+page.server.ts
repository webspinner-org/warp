/**
 * Weaver's Tension — player (v2).
 *
 * The patron is a witness. The SI runs the scenario through its action
 * program; the client posts here to record step results, emit messages,
 * run server-side verifiers, and pause/resume/stop the run.
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
  pauseRun,
  postMessage,
  recordStep,
  resumeRun,
  type OrchestratorContext,
} from '$lib/server/weavers-tension/orchestrator.js';
import type { OperationActor } from '$lib/server/operations.js';
import type { Scenario, StepVerifier } from '$lib/server/weavers-tension/types.js';
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

export const load: PageServerLoad = async ({ parent, params, fetch, cookies }) => {
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

  return {
    user: layoutData.user,
    scenario: {
      slug: scenario.slug,
      title: scenario.title,
      summary: scenario.summary,
      version: scenario.version,
      fixtures: scenario.fixtures,
      steps: scenario.steps,
    },
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
  };
};

export const actions: Actions = {
  recordStep: async ({ params, request, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { error: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { error: 'run-not-found' });
    const body = await request.formData();
    const stepIndex = Number(body.get('stepIndex'));
    const status = String(body.get('status') ?? '') as
      | 'completed'
      | 'failed'
      | 'remediated'
      | 'escalated';
    const evidenceRaw = body.get('evidence');
    let evidence: Record<string, unknown> | undefined;
    if (typeof evidenceRaw === 'string' && evidenceRaw.length > 0) {
      const parsed = safeJsonParse(evidenceRaw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        evidence = parsed as Record<string, unknown>;
      }
    }
    const observation = body.get('observation');
    const attemptsRaw = body.get('attempts');
    const step = loaded.value.steps[stepIndex];
    if (!step) return fail(400, { error: 'step-out-of-range' });
    const actor = await actorFromSession(fetch, session);
    const ctx: OrchestratorContext = { fetch, pbToken, actor };
    const result = await recordStep(ctx, {
      run: found.run,
      scenario: loaded.value,
      step,
      stepIndex,
      status,
      ...(evidence !== undefined ? { evidence } : {}),
      ...(typeof observation === 'string' && observation.length > 0 ? { observation } : {}),
      ...(attemptsRaw !== null ? { attempts: Number(attemptsRaw) } : {}),
    });
    if (!result.ok) return fail(500, { error: result.error.kind });
    return { ok: true };
  },

  message: async ({ params, request, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { error: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { error: 'run-not-found' });
    const fd = await request.formData();
    const bodyText = String(fd.get('body') ?? '').trim();
    if (bodyText.length === 0) return fail(400, { error: 'empty' });
    if (bodyText.length > 8000) return fail(400, { error: 'too-long' });
    const requestedAuthor = String(fd.get('authorKind') ?? '');
    const stepKey = String(fd.get('stepKey') ?? '');
    const actor = await actorFromSession(fetch, session);
    // 'si' and 'system' messages are emitted by the player on behalf
    // of the scenario; they're recorded as such but the audit actor
    // remains the patron. Any value not in { 'si', 'system' } reverts
    // to the patron's own role.
    const authorKind: 'wizard' | 'webspinner' | 'si' | 'system' =
      requestedAuthor === 'si' || requestedAuthor === 'system'
        ? requestedAuthor
        : actor.kind === 'wizard'
          ? 'wizard'
          : 'webspinner';
    const ctx: OrchestratorContext = { fetch, pbToken, actor };
    const posted = await postMessage(ctx, {
      run: found.run,
      scenario: loaded.value,
      authorKind,
      authorId: authorKind === 'si' ? 'si:weavers-tension' : actor.id,
      ...(authorKind === 'si' ? { authorLabel: 'The Loom' } : { authorLabel: actor.email }),
      stepKey: stepKey || 'pre-start',
      body: bodyText,
    });
    if (!posted.ok) return fail(500, { error: posted.error.kind });
    return { ok: true };
  },

  runVerifications: async ({ params, request, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { error: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { error: 'run-not-found' });
    const fd = await request.formData();
    const verifierJson = String(fd.get('verifier') ?? '');
    const verifier = safeJsonParse(verifierJson) as StepVerifier | null;
    if (!verifier) return fail(400, { error: 'bad-verifier' });
    // Pre-substitute fixtures into the verifier so the existing
    // runVerifier (which only knows `answer.*` placeholders) sees
    // resolved values for `{{fixture.X}}`.
    const resolved = substituteVerifierFixtures(verifier, loaded.value, found.run.answers);
    const result = await runVerifier({
      fetch,
      pbToken,
      verifier: resolved,
      answers: found.run.answers,
      ...(request.headers.get('cookie')
        ? { cookieHeader: request.headers.get('cookie') as string }
        : {}),
    });
    return { ok: true, result };
  },

  pause: async ({ params, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { error: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { error: 'run-not-found' });
    const actor = await actorFromSession(fetch, session);
    const r = await pauseRun({ fetch, pbToken, actor }, found.run, loaded.value);
    if (!r.ok) return fail(500, { error: r.error.kind });
    return { ok: true };
  },

  resume: async ({ params, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { error: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { error: 'run-not-found' });
    const actor = await actorFromSession(fetch, session);
    const r = await resumeRun({ fetch, pbToken, actor }, found.run, loaded.value);
    if (!r.ok) return fail(500, { error: r.error.kind });
    return { ok: true };
  },

  finish: async ({ params, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { error: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { error: 'run-not-found' });
    const actor = await actorFromSession(fetch, session);
    const r = await finishRun({ fetch, pbToken, actor }, found.run, loaded.value);
    if (!r.ok) return fail(500, { error: r.error.kind });
    return { ok: true };
  },

  abort: async ({ params, request, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'no-pb-token' });
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) return fail(404, { error: 'scenario-not-found' });
    const found = await getRun(fetch, pbToken, params.runId);
    if (!found.ok || !found.run) return fail(404, { error: 'run-not-found' });
    const fd = await request.formData();
    const reason = String(fd.get('reason') ?? 'patron stopped the run');
    const actor = await actorFromSession(fetch, session);
    const r = await abortRun(
      { fetch, pbToken, actor },
      {
        run: found.run,
        scenario: loaded.value,
        atStepIndex: found.run.currentStepIndex,
        reason,
      },
    );
    if (!r.ok) return fail(500, { error: r.error.kind });
    throw redirect(303, '/admin/weavers-tension');
  },
};

function safeJsonParse(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Pre-substitute `{{fixture.X}}` references inside a verifier's
 * string fields. The existing runVerifier substitutes `{{answer.X.Y}}`
 * itself; for v2 we layer fixtures on top.
 */
function substituteVerifierFixtures(
  verifier: StepVerifier,
  scenario: Scenario,
  answers: Readonly<Record<string, Record<string, unknown>>>,
): StepVerifier {
  const sub = (s: string) => substitutePlaceholders(s, scenario.fixtures, answers);
  switch (verifier.kind) {
    case 'route-status':
      return {
        ...verifier,
        path: sub(verifier.path),
        ...(verifier.bodyContains ? { bodyContains: verifier.bodyContains.map(sub) } : {}),
      };
    case 'pb-row-exists':
      return {
        ...verifier,
        filter: sub(verifier.filter),
        ...(verifier.assertFields
          ? {
              assertFields: Object.fromEntries(
                Object.entries(verifier.assertFields).map(([k, v]) => [k, sub(v)]),
              ),
            }
          : {}),
      };
    case 'audit-event':
      return {
        ...verifier,
        ...(verifier.subjectContains ? { subjectContains: sub(verifier.subjectContains) } : {}),
      };
    case 'op-envelope':
    case 'iframe-element':
      return verifier;
  }
}
