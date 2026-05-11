import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  ensureAuditCollection,
  listAuditEvents,
  type AuditRow,
} from '$lib/server/audit.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch, parent, url }) => {
  const layoutData = await parent();

  const eventType = url.searchParams.get('type') ?? '';
  const result = url.searchParams.get('result') ?? '';
  const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit') ?? 50)));

  let events: readonly AuditRow[] = [];
  let total = 0;
  let setupError: string | undefined;

  try {
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      setupError =
        'PocketBase superuser credentials are not set in the Loom env; the audit log cannot be read.';
    } else {
      const ensured = await ensureAuditCollection(fetch, pbToken);
      if (!ensured.ok) {
        setupError = `Failed to ensure wp_audit collection (HTTP ${ensured.status}): ${ensured.body.slice(0, 200)}`;
      } else {
        const r = await listAuditEvents(fetch, pbToken, {
          limit,
          eventType: eventType || undefined,
          result: result || undefined,
        });
        if (r.ok) {
          events = r.events;
          total = r.total;
        } else {
          setupError = `Failed to read wp_audit (HTTP ${r.status}): ${r.body.slice(0, 200)}`;
        }
      }
    }
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // Distinct types + results from the visible window so the Wizard can
  // filter on them.
  const distinctTypes = Array.from(new Set(events.map((e) => e.event_type))).sort();
  const distinctResults = Array.from(new Set(events.map((e) => e.audit_result))).sort();

  // Strip the heavy `data` field for the client — surface a one-line
  // summary instead. The full payload lands in the detail row on expand.
  const trimmed = events.map((e) => ({
    id: e.id,
    eventId: e.event_id,
    type: e.event_type,
    source: e.event_source,
    subject: e.event_subject,
    time: e.event_time,
    actorKind: e.actor_kind,
    actorId: e.actor_id,
    actorDisplay: e.actor_display_name,
    result: e.audit_result,
    reason: e.audit_reason,
    correlation: e.correlation_id,
    ocsfClass: e.ocsf_class,
    dataKeys: e.data ? Object.keys(e.data) : [],
  }));

  return {
    user: layoutData.user,
    events: trimmed,
    total,
    limit,
    eventType,
    result,
    distinctTypes,
    distinctResults,
    setupError,
  };
};
