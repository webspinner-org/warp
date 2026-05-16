// `wp_database_applications` — one row per Database Application Spinner build.
//
// Each row records the patron's settled schema + the map from each
// schema entity to the PocketBase collection that holds its rows. The
// schema-driven renderer reads this row to know what tabs + tables +
// forms to render; the build dispatcher writes it after creating the
// per-entity collections.
//
// Idempotent on (session_id) — one app per session for v0. A second
// build call on the same session throws "already built"; future
// iterations may add schema migrations.
//
// Per-entity collections (the patron's actual data) are named
// `app_<appId>_<entitySlug>`. Each is a separate PB collection with
// fields typed from the schema's field kinds. Collection names are
// derivable from the metadata row; the renderer + CRUD helpers query
// them through this module.

import { randomBytes } from 'node:crypto';

const PB_URL_DEFAULT = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_database_applications';
const MAX_SCHEMA_BYTES = 256 * 1024;

export interface SchemaField {
  readonly name: string;
  readonly kind: 'text' | 'number' | 'date' | 'money' | 'yes-no' | string;
  readonly describes?: string;
}

export interface SchemaLink {
  readonly to: string;
  readonly describes?: string;
}

export interface SchemaEntity {
  readonly name: string;
  readonly describes?: string;
  readonly fields: readonly SchemaField[];
  readonly links?: readonly SchemaLink[];
}

export interface SchemaDraft {
  readonly entities: readonly SchemaEntity[];
}

export interface EntityMap {
  readonly name: string;
  readonly slug: string;
  readonly collectionName: string;
  readonly fields: readonly SchemaField[];
  readonly links: readonly SchemaLink[];
}

export interface DatabaseApplicationRow {
  readonly id: string;
  readonly appId: string;
  readonly sessionId: string;
  readonly spinnerId: string;
  readonly patronSentence: string;
  readonly domain: string;
  readonly schemaDraft: SchemaDraft;
  readonly entities: readonly EntityMap[];
  readonly builtAt: string;
  readonly status: 'active' | 'archived';
}

interface PBRow {
  readonly id: string;
  readonly app_id: string;
  readonly session_id: string;
  readonly spinner_id: string;
  readonly patron_sentence: string;
  readonly domain: string;
  readonly schema_draft: SchemaDraft;
  readonly entities: readonly EntityMap[];
  readonly built_at: string;
  readonly status: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

function parseRow(row: PBRow): DatabaseApplicationRow {
  return {
    id: row.id,
    appId: row.app_id,
    sessionId: row.session_id,
    spinnerId: row.spinner_id,
    patronSentence: row.patron_sentence,
    domain: row.domain,
    schemaDraft: row.schema_draft,
    entities: row.entities,
    builtAt: row.built_at,
    status: row.status as DatabaseApplicationRow['status'],
  };
}

/**
 * Sanitize a free-form name (entity, field) into a PB-safe identifier.
 * Lowercase, alphanumeric+underscore, no leading digit, max 60 chars.
 */
export function sanitizeForPb(s: string): string {
  let out = String(s ?? '')
    .toLowerCase()
    .trim();
  out = out.replace(/[^a-z0-9_]+/g, '_');
  out = out.replace(/^_+|_+$/g, '');
  out = out.replace(/_+/g, '_');
  if (out.length === 0) out = 'unnamed';
  if (!/^[a-z]/.test(out)) out = 'x_' + out;
  return out.slice(0, 60);
}

/**
 * 8-character lowercase hex — used as the app id prefix in PB
 * collection names. Conflict probability is negligible for a single
 * demo Cell (~10^9 combinations).
 */
export function generateAppId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Map a schema field kind to a PB field definition.
 */
interface PBFieldDef {
  readonly name: string;
  readonly type: string;
  readonly required?: boolean;
  readonly options?: Record<string, unknown>;
  readonly maxLength?: number;
}

function pbFieldFromSchema(field: SchemaField): PBFieldDef {
  const name = sanitizeForPb(field.name);
  switch (field.kind) {
    case 'date':
      return { name, type: 'date' };
    case 'number':
      return { name, type: 'number' };
    case 'money':
      // Stored as a number — the renderer formats it as currency on
      // display. Future revision could split into integer-cents to
      // avoid float-rounding issues; for v0 a plain number is fine.
      return { name, type: 'number' };
    case 'yes-no':
      return { name, type: 'bool' };
    case 'text':
    default:
      return { name, type: 'text', maxLength: 5_000 };
  }
}

/**
 * Idempotently ensure the metadata collection exists.
 */
export async function ensureDatabaseApplicationsCollection(
  fetchFn: typeof fetch,
  token: string,
  pbUrl: string = PB_URL_DEFAULT,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const head = await fetchFn(`${pbUrl}/api/collections/${COLLECTION}`, {
    headers: authHeaders(token),
  });
  if (head.ok) return { ok: true };
  if (head.status !== 404) return { ok: false, status: head.status, body: await head.text() };

  const create = await fetchFn(`${pbUrl}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'app_id', type: 'text', required: true, max: 32 },
        { name: 'session_id', type: 'text', required: true, max: 128 },
        { name: 'spinner_id', type: 'text', required: true, max: 128 },
        { name: 'patron_sentence', type: 'text', required: true, max: 2048 },
        { name: 'domain', type: 'text', required: false, max: 256 },
        { name: 'schema_draft', type: 'json', required: true, maxSize: MAX_SCHEMA_BYTES },
        { name: 'entities', type: 'json', required: true, maxSize: MAX_SCHEMA_BYTES },
        { name: 'built_at', type: 'text', required: true, max: 32 },
        { name: 'status', type: 'text', required: true, max: 16 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${COLLECTION}_app_id ON ${COLLECTION} (app_id)`,
        `CREATE UNIQUE INDEX idx_${COLLECTION}_session_id ON ${COLLECTION} (session_id)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

export async function findAppBySessionId(
  fetchFn: typeof fetch,
  token: string,
  sessionId: string,
  pbUrl: string = PB_URL_DEFAULT,
): Promise<
  { ok: true; row: DatabaseApplicationRow | null } | { ok: false; status: number; body: string }
> {
  const params = new URLSearchParams();
  params.set('perPage', '1');
  params.set('filter', `session_id = ${JSON.stringify(sessionId)}`);
  const res = await fetchFn(`${pbUrl}/api/collections/${COLLECTION}/records?${params.toString()}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as { items?: readonly PBRow[] };
  const row = body.items && body.items.length > 0 ? parseRow(body.items[0]!) : null;
  return { ok: true, row };
}

/**
 * Create a per-entity PB collection. Idempotent — returns ok if the
 * collection already exists (verifies by HEAD).
 */
export async function createEntityCollection(
  fetchFn: typeof fetch,
  token: string,
  collectionName: string,
  fields: readonly SchemaField[],
  pbUrl: string = PB_URL_DEFAULT,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  // HEAD: if exists, return ok.
  const head = await fetchFn(`${pbUrl}/api/collections/${collectionName}`, {
    headers: authHeaders(token),
  });
  if (head.ok) return { ok: true };
  if (head.status !== 404) return { ok: false, status: head.status, body: await head.text() };

  const fieldDefs = fields.map(pbFieldFromSchema);
  // Always append the autodate created/updated for the patron's data.
  const allFields = [
    ...fieldDefs,
    { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
    { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
  ];

  const create = await fetchFn(`${pbUrl}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: collectionName,
      type: 'base',
      fields: allFields,
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

export interface CreateAppInput {
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly sessionId: string;
  readonly spinnerId: string;
  readonly patronSentence: string;
  readonly domain: string;
  readonly schemaDraft: SchemaDraft;
  readonly pbUrl?: string;
}

/**
 * Create the wp_database_applications row + every per-entity collection
 * derived from the schema. Returns the parsed row.
 *
 * Idempotency: if a row already exists for this session_id, throws
 * 'already-built'. v0 — one app per session.
 */
export async function createApp(
  input: CreateAppInput,
): Promise<
  | { ok: true; row: DatabaseApplicationRow }
  | { ok: false; kind: 'already-built'; existing: DatabaseApplicationRow }
  | { ok: false; kind: 'backend'; detail: string }
> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const ensured = await ensureDatabaseApplicationsCollection(input.fetchFn, input.token, pbUrl);
  if (!ensured.ok)
    return {
      ok: false,
      kind: 'backend',
      detail: `ensure-collection: HTTP ${ensured.status} ${ensured.body.slice(0, 200)}`,
    };

  const existing = await findAppBySessionId(input.fetchFn, input.token, input.sessionId, pbUrl);
  if (!existing.ok)
    return {
      ok: false,
      kind: 'backend',
      detail: `find-app: HTTP ${existing.status} ${existing.body.slice(0, 200)}`,
    };
  if (existing.row !== null) {
    return { ok: false, kind: 'already-built', existing: existing.row };
  }

  // Derive entity map: name → slug → collection name. Sanitize each so
  // PB accepts it. Conflicts within one app (two entities sanitising to
  // the same slug) are suffixed _2, _3, etc.
  const appId = generateAppId();
  const usedSlugs = new Set<string>();
  const entities: EntityMap[] = [];
  for (const entity of input.schemaDraft.entities) {
    const base = sanitizeForPb(entity.name);
    let slug = base;
    let i = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}_${i++}`;
    }
    usedSlugs.add(slug);
    const collectionName = `app_${appId}_${slug}`.slice(0, 80);
    entities.push({
      name: entity.name,
      slug,
      collectionName,
      fields: entity.fields ?? [],
      links: entity.links ?? [],
    });
  }

  // Create each entity's PB collection.
  for (const entity of entities) {
    const created = await createEntityCollection(
      input.fetchFn,
      input.token,
      entity.collectionName,
      entity.fields,
      pbUrl,
    );
    if (!created.ok) {
      return {
        ok: false,
        kind: 'backend',
        detail: `create-collection ${entity.collectionName}: HTTP ${created.status} ${created.body.slice(0, 200)}`,
      };
    }
  }

  // Write the app metadata row.
  const builtAt = new Date().toISOString();
  const payload = {
    app_id: appId,
    session_id: input.sessionId,
    spinner_id: input.spinnerId,
    patron_sentence: input.patronSentence,
    domain: input.domain,
    schema_draft: input.schemaDraft,
    entities,
    built_at: builtAt,
    status: 'active',
  };
  const create = await input.fetchFn(`${pbUrl}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(input.token),
    body: JSON.stringify(payload),
  });
  if (!create.ok) {
    return {
      ok: false,
      kind: 'backend',
      detail: `create-app-row: HTTP ${create.status} ${(await create.text()).slice(0, 200)}`,
    };
  }
  const created = (await create.json()) as PBRow;
  return { ok: true, row: parseRow(created) };
}

export async function listEntityRows(
  fetchFn: typeof fetch,
  token: string,
  collectionName: string,
  opts: { perPage?: number; page?: number } = {},
  pbUrl: string = PB_URL_DEFAULT,
): Promise<
  | { ok: true; items: readonly Record<string, unknown>[]; totalItems: number }
  | { ok: false; status: number; body: string }
> {
  const params = new URLSearchParams();
  params.set('perPage', String(opts.perPage ?? 100));
  params.set('page', String(opts.page ?? 1));
  params.set('sort', '-created');
  const res = await fetchFn(
    `${pbUrl}/api/collections/${collectionName}/records?${params.toString()}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const body = (await res.json()) as {
    items?: readonly Record<string, unknown>[];
    totalItems?: number;
  };
  return {
    ok: true,
    items: body.items ?? [],
    totalItems: body.totalItems ?? 0,
  };
}

export async function createEntityRow(
  fetchFn: typeof fetch,
  token: string,
  collectionName: string,
  data: Record<string, unknown>,
  pbUrl: string = PB_URL_DEFAULT,
): Promise<
  { ok: true; row: Record<string, unknown> } | { ok: false; status: number; body: string }
> {
  const res = await fetchFn(`${pbUrl}/api/collections/${collectionName}/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  const row = (await res.json()) as Record<string, unknown>;
  return { ok: true, row };
}
