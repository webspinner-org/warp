import { error } from '@sveltejs/kit';
import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  ensureOperationsCollection,
  getOperation,
  type OperationDetail,
} from '$lib/server/operations.js';
import { ensureAuditCollection, listAuditEvents, type AuditRow } from '$lib/server/audit.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch, parent, params }) => {
  const layoutData = await parent();
  const opId = params.opId;

  let operation: OperationDetail | null = null;
  let auditEvents: readonly AuditRow[] = [];
  let setupError: string | undefined;

  try {
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      setupError =
        'PocketBase superuser credentials are not set in the Loom env; operations cannot be read.';
    } else {
      const ensuredOps = await ensureOperationsCollection(fetch, pbToken);
      if (!ensuredOps.ok) {
        setupError = `Failed to ensure wp_operations collection (HTTP ${ensuredOps.status}): ${ensuredOps.body.slice(0, 200)}`;
      } else {
        const opResult = await getOperation(fetch, pbToken, opId);
        if (!opResult.ok) {
          setupError = `Failed to read wp_operations (HTTP ${opResult.status}): ${opResult.body.slice(0, 200)}`;
        } else if (!opResult.row) {
          throw error(404, `Operation not found: ${opId}`);
        } else {
          operation = opResult.row;
          const ensuredAudit = await ensureAuditCollection(fetch, pbToken);
          if (ensuredAudit.ok) {
            const auditResult = await listAuditEvents(fetch, pbToken, {
              correlationId: opId,
              limit: 50,
            });
            if (auditResult.ok) auditEvents = auditResult.events;
          }
        }
      }
    }
  } catch (e) {
    // Re-throw SvelteKit errors (like the 404 above).
    if (e instanceof Error && 'status' in e) throw e;
    setupError = e instanceof Error ? e.message : String(e);
  }

  return {
    user: layoutData.user,
    operation: operation
      ? {
          opId: operation.opId,
          kind: operation.kind,
          status: operation.status,
          startedAt: operation.startedAt,
          endedAt: operation.endedAt,
          actor: operation.actor,
          input: operation.input,
          output: operation.output,
          error: operation.error,
          parentOpId: operation.parentOpId,
        }
      : null,
    auditEvents: auditEvents.map((e) => ({
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
      ocsfClass: e.ocsf_class,
      data: e.data ?? {},
    })),
    setupError,
  };
};
