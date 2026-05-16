// GET/POST /admin/db-app/[sessionId]/[entity] — CRUD against the
// patron's per-entity PocketBase collection. GET lists rows; POST
// creates one. Routes are scoped to (sessionId, entity slug); the
// per-entity collection name is resolved through the
// wp_database_applications metadata row, never trusted from the URL.

import { error, json } from '@sveltejs/kit';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import {
  findAppBySessionId,
  listEntityRows,
  createEntityRow,
} from '$lib/server/database-applications.js';
import type { RequestHandler } from './$types.js';

async function loadAppAndEntity(
  f: typeof fetch,
  pbToken: string,
  sessionId: string,
  entitySlug: string,
): Promise<
  | {
      ok: true;
      entity: {
        name: string;
        slug: string;
        collectionName: string;
        fields: readonly { name: string; kind: string; describes?: string }[];
        links: readonly { to: string; describes?: string }[];
      };
    }
  | { ok: false; status: number; body: string }
> {
  const found = await findAppBySessionId(f, pbToken, sessionId);
  if (!found.ok) return { ok: false, status: found.status, body: found.body };
  if (found.row === null) return { ok: false, status: 404, body: 'no app for this session' };
  const entity = found.row.entities.find((e) => e.slug === entitySlug);
  if (!entity) return { ok: false, status: 404, body: `no entity "${entitySlug}" in this app` };
  return { ok: true, entity };
}

async function resolveAuth(
  cookies: Parameters<RequestHandler>[0]['cookies'],
  f: typeof fetch,
): Promise<string> {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');
  if (session.collection === 'users') {
    const r = await refreshUser(f, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
  } else {
    const r = await refreshSuperuser(f, session.token);
    if (!r.ok) throw error(401, 'Session expired.');
  }
  return session.token;
}

export const GET: RequestHandler = async ({ params, cookies, fetch: f, url }) => {
  const pbToken = await resolveAuth(cookies, f);
  const sessionId = params.sessionId ?? '';
  const entitySlug = params.entity ?? '';
  if (!sessionId || !entitySlug) throw error(400, 'sessionId and entity required');

  const resolved = await loadAppAndEntity(f, pbToken, sessionId, entitySlug);
  if (!resolved.ok) {
    return json(
      { ok: false, kind: 'not-found', detail: resolved.body },
      { status: resolved.status },
    );
  }

  const perPage = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get('perPage') ?? '100', 10) || 100),
  );
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const listed = await listEntityRows(f, pbToken, resolved.entity.collectionName, {
    perPage,
    page,
  });
  if (!listed.ok) {
    return json(
      { ok: false, kind: 'backend', status: listed.status, body: listed.body },
      { status: 502 },
    );
  }

  return json({
    ok: true,
    entity: resolved.entity,
    items: listed.items,
    totalItems: listed.totalItems,
    page,
    perPage,
  });
};

export const POST: RequestHandler = async ({ params, cookies, fetch: f, request }) => {
  const pbToken = await resolveAuth(cookies, f);
  const sessionId = params.sessionId ?? '';
  const entitySlug = params.entity ?? '';
  if (!sessionId || !entitySlug) throw error(400, 'sessionId and entity required');

  const resolved = await loadAppAndEntity(f, pbToken, sessionId, entitySlug);
  if (!resolved.ok) {
    return json(
      { ok: false, kind: 'not-found', detail: resolved.body },
      { status: resolved.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'request body must be JSON');
  }
  if (typeof body !== 'object' || body === null) throw error(400, 'body must be a JSON object');

  // Whitelist only the declared schema fields; ignore everything else.
  // Coerce types per the field's kind so the PB write succeeds even
  // if the browser sent strings for numbers / booleans.
  const payload: Record<string, unknown> = {};
  for (const f of resolved.entity.fields) {
    const raw = (body as Record<string, unknown>)[f.name];
    if (raw === undefined || raw === null || raw === '') continue;
    payload[f.name] = coerceFieldValue(raw, f.kind);
  }

  const created = await createEntityRow(f, pbToken, resolved.entity.collectionName, payload);
  if (!created.ok) {
    return json(
      { ok: false, kind: 'backend', status: created.status, body: created.body },
      { status: 502 },
    );
  }

  return json({ ok: true, row: created.row });
};

function coerceFieldValue(raw: unknown, kind: string): unknown {
  switch (kind) {
    case 'number':
    case 'money': {
      if (typeof raw === 'number') return raw;
      const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'yes-no':
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'string') {
        const v = raw.toLowerCase();
        return v === 'yes' || v === 'true' || v === '1' || v === 'on';
      }
      return Boolean(raw);
    case 'date': {
      if (raw instanceof Date) return raw.toISOString();
      const s = String(raw);
      // PocketBase accepts ISO 8601; an HTML date input gives YYYY-MM-DD.
      // Pad to ISO with midnight UTC.
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00.000Z`;
      return s;
    }
    case 'text':
    default:
      return String(raw);
  }
}
