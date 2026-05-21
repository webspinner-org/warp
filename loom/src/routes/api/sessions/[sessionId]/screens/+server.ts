/**
 * PATCH /api/sessions/[sessionId]/screens
 *
 * Replace the screensDraft inside a wp_spinner_sessions row with the
 * patron's edited version. Block-6 endpoint for the forms-first
 * editor: WebbaseRuntime emits onEdit(nextScreensDraft); the Loom
 * frontend (Block 7) debounces and POSTs here.
 *
 * Authorisation: warp_hub cookie email MUST equal the session row's
 * actor_email. The spinner_id is locked to `database-application` —
 * the only Spinner that produces a patron-editable screensDraft.
 *
 * The endpoint replaces `state.screensDraft` and bumps
 * `state.screensDraftEditedAt`. All other state fields
 * (clarifications, provenance, sentence, capability history) are
 * preserved untouched — those belong to the Weaver / Spinner, not
 * the editor.
 *
 * Request body:
 *   { screensDraft: { screens: [...], navigation?: [...], ... } }
 *
 * Response:
 *   200 { ok: true, updatedAt: <iso>, screensDraft: { ... } }
 *   400 invalid body
 *   401 not signed in
 *   403 session belongs to another patron
 *   404 session not found
 *   413 payload too large
 *   502 PocketBase unreachable
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const SPINNER_ID = 'database-application';
const MAX_BODY_BYTES = 256 * 1024; // mirrors MAX_STATE_BYTES in spinner-session.ts

interface PBSpinnerSessionRow {
  readonly id: string;
  readonly session_id: string;
  readonly spinner_id: string;
  readonly actor_email?: string;
  readonly phase: string;
  readonly state: Record<string, unknown> | null;
  readonly updated_at: string;
}

interface ScreenField {
  readonly id: unknown;
  readonly kind?: unknown;
  readonly label?: unknown;
}
interface ScreenSection {
  readonly fields?: unknown;
}
interface ScreenLayout {
  readonly sections?: unknown;
}
interface ScreenLike {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly layout?: ScreenLayout | unknown;
}

/**
 * Validate the screensDraft shape just enough to keep the session
 * recoverable. The editor only does rename / delete / add of fields,
 * so the bag must be {screens: ScreenLike[]} with each form screen's
 * field having an `id`. Anything richer (navigation, branding, etc.)
 * passes through unvalidated.
 */
function validateScreensDraft(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'screensDraft must be an object' };
  }
  const bag = value as { screens?: unknown };
  if (!Array.isArray(bag.screens)) {
    return { ok: false, reason: 'screensDraft.screens must be an array' };
  }
  for (let i = 0; i < bag.screens.length; i++) {
    const s = bag.screens[i] as ScreenLike;
    if (!s || typeof s !== 'object') {
      return { ok: false, reason: `screens[${i}] must be an object` };
    }
    if (typeof s.id !== 'string' || s.id.length === 0) {
      return { ok: false, reason: `screens[${i}].id must be a non-empty string` };
    }
    if (s.kind !== 'form') continue; // only validate form screens deeply
    const layout = s.layout as ScreenLayout | undefined;
    const sections = layout?.sections;
    if (sections !== undefined && !Array.isArray(sections)) {
      return { ok: false, reason: `screens[${i}].layout.sections must be an array` };
    }
    for (let sx = 0; sx < (sections?.length ?? 0); sx++) {
      const sec = sections![sx] as ScreenSection;
      const fields = sec?.fields;
      if (!Array.isArray(fields)) {
        return {
          ok: false,
          reason: `screens[${i}].layout.sections[${sx}].fields must be an array`,
        };
      }
      for (let fi = 0; fi < fields.length; fi++) {
        const f = fields[fi] as ScreenField;
        if (!f || typeof f !== 'object') {
          return {
            ok: false,
            reason: `screens[${i}].layout.sections[${sx}].fields[${fi}] must be an object`,
          };
        }
        if (typeof f.id !== 'string' || f.id.length === 0) {
          return {
            ok: false,
            reason: `screens[${i}].layout.sections[${sx}].fields[${fi}].id must be a non-empty string`,
          };
        }
      }
    }
  }
  return { ok: true };
}

export const PATCH: RequestHandler = async ({ params, request, cookies, fetch: f }) => {
  const sessionId = params.sessionId ?? '';
  if (!sessionId) throw error(400, 'sessionId required');

  const hub = getHubSession(cookies);
  if (!hub) throw error(401, 'sign in to edit screens');

  // Raw body size guard before JSON-parsing — never accept multi-MB
  // payloads that would slow PB writes and bloat the session row.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw error(413, `body too large: ${raw.length} bytes > ${MAX_BODY_BYTES}`);
  }
  let body: { screensDraft?: unknown };
  try {
    body = JSON.parse(raw) as { screensDraft?: unknown };
  } catch {
    throw error(400, 'body is not valid JSON');
  }
  const validity = validateScreensDraft(body.screensDraft);
  if (!validity.ok) throw error(400, validity.reason);

  const token = await loomPbToken(f);
  if (!token) throw error(500, 'pb-auth failed');

  const filter = encodeURIComponent(
    `spinner_id = ${JSON.stringify(SPINNER_ID)} && session_id = ${JSON.stringify(sessionId)}`,
  );
  const listRes = await f(
    `${PB_URL}/api/collections/wp_spinner_sessions/records?perPage=1&filter=${filter}`,
    { headers: { Authorization: token } },
  );
  if (!listRes.ok) throw error(502, `pb-list-sessions: ${listRes.status}`);
  const listBody = (await listRes.json()) as { items?: readonly PBSpinnerSessionRow[] };
  const row = listBody.items?.[0];
  if (!row) throw error(404, 'session not found');
  if (row.actor_email !== hub.email) {
    throw error(403, 'this session belongs to a different patron');
  }

  const nowIso = new Date().toISOString();
  const prevState = row.state ?? {};
  const nextState = {
    ...prevState,
    screensDraft: body.screensDraft,
    screensDraftEditedAt: nowIso,
  };

  // Final size check on the merged payload so we never exceed
  // wp_spinner_sessions.state.maxSize (256 KB).
  const serialised = JSON.stringify(nextState);
  if (serialised.length > MAX_BODY_BYTES) {
    throw error(
      413,
      `merged session state too large: ${serialised.length} bytes > ${MAX_BODY_BYTES}`,
    );
  }

  const patchRes = await f(`${PB_URL}/api/collections/wp_spinner_sessions/records/${row.id}`, {
    method: 'PATCH',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: nextState, updated_at: nowIso }),
  });
  if (!patchRes.ok) {
    const txt = await patchRes.text().catch(() => '<unreadable>');
    throw error(502, `pb-patch-session: ${patchRes.status} ${txt.slice(0, 200)}`);
  }

  return json({ ok: true, updatedAt: nowIso, screensDraft: body.screensDraft });
};
