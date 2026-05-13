import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  ensureOperationsCollection,
  listOperations,
  type OperationDetail,
  type OperationKind,
  type OperationStatus,
  type OperationActor,
} from '$lib/server/operations.js';
import type { PageServerLoad } from './$types.js';

const VALID_KINDS: readonly OperationKind[] = [
  'spinner.sign',
  'spinner.verify',
  'spinner.author',
  'spinner.publish',
  'spinner.install',
  'spinner.update',
  'spinner.uninstall',
  'runner.dispatch',
];

const VALID_STATUSES: readonly OperationStatus[] = ['ok', 'failed', 'partial'];

const VALID_ACTOR_KINDS: readonly OperationActor['kind'][] = [
  'wizard',
  'webspinner',
  'meta-runtime',
  'system',
];

function parseMultiSelect<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): readonly T[] {
  if (!raw) return [];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.filter((p): p is T => (allowed as readonly string[]).includes(p));
}

export interface OperationListRow {
  readonly opId: string;
  readonly kind: string;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly actorKind: string;
  readonly actorId: string;
  readonly actorEmail: string;
  readonly subject: string;
  readonly errorKind: string;
}

function trimRowForClient(row: OperationDetail): OperationListRow {
  // The full input/output/error live on the detail page. List view shows
  // only enough to disambiguate. Subject is the bundlePath when present;
  // a future patch can resolve to the manifest's Spinner name.
  const subject =
    typeof row.input['bundlePath'] === 'string' ? (row.input['bundlePath'] as string) : '';
  return {
    opId: row.opId,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    actorKind: row.actor.kind,
    actorId: row.actor.id,
    actorEmail: row.actor.email ?? '',
    subject,
    errorKind: row.error?.kind ?? '',
  };
}

export const load: PageServerLoad = async ({ fetch, parent, url }) => {
  const layoutData = await parent();

  const kinds = parseMultiSelect(url.searchParams.get('kinds'), VALID_KINDS);
  const statuses = parseMultiSelect(url.searchParams.get('statuses'), VALID_STATUSES);
  const actorKinds = parseMultiSelect(url.searchParams.get('actors'), VALID_ACTOR_KINDS);
  const sinceParam = url.searchParams.get('since') ?? '';
  const cursor = url.searchParams.get('cursor') ?? '';
  const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit') ?? 50)));

  // Resolve `since` shortcuts → ISO timestamps.
  const now = Date.now();
  let since: string | undefined;
  if (sinceParam === '24h') since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  else if (sinceParam === '7d') since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  else if (sinceParam === '30d') since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  else if (sinceParam === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    since = d.toISOString();
  } else if (sinceParam.length > 0) {
    since = sinceParam; // assume caller passed a valid ISO string
  }

  let rows: readonly OperationDetail[] = [];
  let nextCursor: string | null = null;
  let setupError: string | undefined;

  try {
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      setupError =
        'PocketBase superuser credentials are not set in the Loom env; operations cannot be read.';
    } else {
      const ensured = await ensureOperationsCollection(fetch, pbToken);
      if (!ensured.ok) {
        setupError = `Failed to ensure wp_operations collection (HTTP ${ensured.status}): ${ensured.body.slice(0, 200)}`;
      } else {
        const r = await listOperations(fetch, pbToken, {
          ...(kinds.length > 0 ? { kinds } : {}),
          ...(statuses.length > 0 ? { statuses } : {}),
          ...(actorKinds.length > 0 ? { actorKinds } : {}),
          ...(since !== undefined ? { since } : {}),
          ...(cursor.length > 0 ? { cursor } : {}),
          limit,
        });
        if (r.ok) {
          rows = r.rows;
          nextCursor = r.nextCursor;
        } else {
          setupError = `Failed to read wp_operations (HTTP ${r.status}): ${r.body.slice(0, 200)}`;
        }
      }
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  return {
    user: layoutData.user,
    rows: rows.map(trimRowForClient),
    nextCursor,
    filters: {
      kinds,
      statuses,
      actorKinds,
      since: sinceParam,
      limit,
    },
    options: {
      kinds: VALID_KINDS,
      statuses: VALID_STATUSES,
      actorKinds: VALID_ACTOR_KINDS,
      sinceChoices: ['today', '24h', '7d', '30d', 'all'] as const,
      limits: [25, 50, 100, 200] as const,
    },
    setupError,
  };
};
