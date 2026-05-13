/**
 * Weaver's Tension — index page.
 *
 * Lists available scenarios (read from disk via the loader) + recent
 * runs (in-progress and completed). Patrons start a new run from
 * here; Wizards review historical runs.
 */

import { error } from '@sveltejs/kit';
import { getSession } from '$lib/server/session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { listScenarios } from '$lib/server/weavers-tension/loader.js';
import { ensureRunsCollection, listRuns } from '$lib/server/weavers-tension/runs.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ parent, fetch, cookies }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');
  const layoutData = await parent();

  const scenarios = await listScenarios();

  let runs: Awaited<ReturnType<typeof listRuns>>;
  const pbToken = await loomPbToken(fetch);
  if (pbToken) {
    await ensureRunsCollection(fetch, pbToken);
    runs = await listRuns(fetch, pbToken, { limit: 20 });
  } else {
    runs = { ok: false, status: 500, body: 'no-pb-token' };
  }

  return {
    user: layoutData.user,
    scenarios,
    recentRuns: runs.ok
      ? runs.runs.map((r) => ({
          runId: r.runId,
          scenarioSlug: r.scenarioSlug,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt ?? null,
          currentStepIndex: r.currentStepIndex,
          actorEmail: r.actor.email ?? r.actor.id,
        }))
      : [],
    runsError: runs.ok ? null : { status: runs.status, body: runs.body },
  };
};
