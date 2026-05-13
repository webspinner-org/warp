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
import {
  ensureRunsCollection,
  listRuns,
  patchRunStatus,
} from '$lib/server/weavers-tension/runs.js';
import type { PageServerLoad } from './$types.js';

const STALE_RUN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

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

    // Reap any stale in-progress / paused runs whose last update is
    // older than the staleness window. These are runs whose tab
    // closed without firing the beforeunload beacon (crash, kill,
    // network drop). We mark them aborted so the recent-runs list
    // doesn't accumulate phantom "in-progress" rows the patron
    // can't actually resume.
    if (runs.ok) {
      const now = Date.now();
      const stale = runs.runs.filter(
        (r) =>
          (r.status === 'in-progress' || r.status === 'paused') &&
          now - new Date(r.updatedAt).getTime() > STALE_RUN_TIMEOUT_MS,
      );
      for (const r of stale) {
        await patchRunStatus(fetch, pbToken, r, 'aborted');
      }
      // Re-fetch so the listing reflects the reaping.
      if (stale.length > 0) {
        runs = await listRuns(fetch, pbToken, { limit: 20 });
      }
    }
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
