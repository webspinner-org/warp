import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  ensureJournalCollection,
  listRecent,
  countEntries,
  type JournalEntry,
} from '$lib/server/journal.js';
import type { PageServerLoad } from './$types.js';

const HORIZON_DAYS = 30;

export const load: PageServerLoad = async ({ fetch, parent }) => {
  const layoutData = await parent();

  let entries: readonly JournalEntry[] = [];
  let total = 0;
  let setupError: string | undefined;

  try {
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      setupError =
        'PocketBase superuser credentials (WARP_PB_EMAIL / WARP_PB_PASSWORD) are not set; the Loom cannot reach the Grimoire.';
    } else {
      const ensured = await ensureJournalCollection(fetch, pbToken);
      if (!ensured.ok) {
        const e = ensured.error;
        setupError =
          e.kind === 'backend'
            ? `Failed to ensure wp_journal_entries (HTTP ${e.status}): ${e.body.slice(0, 200)}`
            : `Failed to ensure wp_journal_entries: ${e.message}`;
      } else {
        const recentResult = await listRecent(fetch, pbToken, { horizonDays: HORIZON_DAYS });
        if (recentResult.ok) entries = recentResult.value;
        const totalResult = await countEntries(fetch, pbToken);
        if (totalResult.ok) total = totalResult.value;
      }
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // Don't ship embeddings to the client — they're noisy and large.
  const stripped = entries.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    kind: e.kind,
    title: e.title,
    body: e.body,
    tags: e.tags ?? [],
    related_spinners: e.related_spinners ?? [],
    public: e.public ?? false,
  }));

  return {
    user: layoutData.user,
    entries: stripped,
    total,
    horizonDays: HORIZON_DAYS,
    setupError,
  };
};
