/**
 * Weaver's Tension — scenario landing page.
 *
 * Two paths:
 *   GET  /admin/weavers-tension/<slug>  — show scenario detail + button to start a new run
 *   POST                                — create a new run and redirect to /<slug>/<runId>
 */

import { error, fail, redirect } from '@sveltejs/kit';
import { getSession } from '$lib/server/session.js';
import { loomPbToken, refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { getScenario } from '$lib/server/weavers-tension/loader.js';
import { startRun } from '$lib/server/weavers-tension/orchestrator.js';
import type { OperationActor } from '$lib/server/operations.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ parent, params, cookies }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');
  const layoutData = await parent();
  const loaded = await getScenario(params.scenario);
  if (!loaded.ok) {
    throw error(404, `Scenario "${params.scenario}" not found: ${loaded.error.kind}`);
  }
  return {
    user: layoutData.user,
    scenario: {
      slug: loaded.value.slug,
      title: loaded.value.title,
      summary: loaded.value.summary,
      stepCount: loaded.value.steps.length,
      steps: loaded.value.steps.map((s) => ({ key: s.key, title: s.title })),
    },
  };
};

export const actions: Actions = {
  start: async ({ params, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) throw error(401, 'Not authenticated.');
    const loaded = await getScenario(params.scenario);
    if (!loaded.ok) {
      return fail(404, {
        topLevelError: { kind: loaded.error.kind, detail: 'scenario not found' },
      });
    }

    let actorEmail: string;
    let actorId: string;
    let actorKind: OperationActor['kind'];
    if (session.collection === 'users') {
      const r = await refreshUser(fetch, session.token);
      if (!r.ok) throw error(401, 'Session expired.');
      actorEmail = r.value.record.email;
      actorId = r.value.record.id;
      actorKind = 'webspinner';
    } else {
      const r = await refreshSuperuser(fetch, session.token);
      if (!r.ok) throw error(401, 'Session expired.');
      actorEmail = r.auth.record.email;
      actorId = r.auth.record.id;
      actorKind = 'wizard';
    }

    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      return fail(500, {
        topLevelError: {
          kind: 'no-pb-token',
          detail: 'Cannot reach PocketBase — set WARP_PB_EMAIL/PASSWORD on the Loom.',
        },
      });
    }

    const started = await startRun(
      { fetch, pbToken, actor: { kind: actorKind, id: actorId, email: actorEmail } },
      loaded.value,
    );
    if (!started.ok) {
      return fail(500, {
        topLevelError: { kind: started.error.kind, detail: started.error.detail },
      });
    }
    throw redirect(303, `/admin/weavers-tension/${params.scenario}/${started.value.run.runId}`);
  },
};
