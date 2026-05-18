/**
 * Webspinner Application Package registry — server-side store for
 * patron-published Webbase bundles, keyed by a short URL-friendly
 * code. Recipients arrive at /app/<shortCode>?t=<install_token>
 * (the surface page renders a preview + Open button; authors of
 * record can also see their own at /me).
 *
 * Republish-on-update: an author re-publishing the same source app
 * UPSERTS the existing row (looked up by cell_key_fingerprint +
 * origin_app_id) so the short_code + install_token stay stable
 * across edits. The URL the author emailed once continues to point
 * at the latest version.
 *
 * Collection shape:
 *   wp_app_packages
 *     short_code              text  (8 chars; unique)
 *     wsap_json               json  (full signed bundle; 5MB max)
 *     sender_email            email (verified at publish)
 *     cell_key_fingerprint    text  (32 hex; provenance)
 *     origin_app_id           text  (the author's wp_database_applications id)
 *     app_name                text  (display name; for /me dashboard)
 *     domain                  text  (informal domain label)
 *     version                 number (republish counter)
 *     passphrase_hash         text  (scrypt; optional)
 *     passphrase_salt         text  (16 hex bytes; optional)
 *     created                 autodate
 *     updated                 autodate
 *     expires_at              date  (refreshed on each republish)
 *     install_token           text  (16 hex bytes; URL capability)
 *     install_count           number
 *     max_installs            number (default 5)
 */

import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import { randomToken } from './email-verify.js';

const PACKAGES = 'wp_app_packages' as const;
const PB_URL_DEFAULT = process.env['WARP_PB_URL'] ?? 'http://127.0.0.1:8091';
const RETENTION_DAYS = 30;
const DEFAULT_MAX_INSTALLS = 5;

interface PBRow extends Record<string, unknown> {
  id: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}

interface PackageRow extends PBRow {
  short_code: string;
  wsap_json: unknown;
  sender_email: string;
  cell_key_fingerprint: string;
  origin_app_id: string;
  app_name: string;
  domain: string;
  version: number;
  passphrase_hash: string;
  passphrase_salt: string;
  expires_at: string;
  install_token: string;
  install_count: number;
  max_installs: number;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: token,
    'Content-Type': 'application/json',
  };
}

async function ensurePackagesCollection(
  fetchFn: typeof fetch,
  token: string,
  pbUrl: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const head = await fetchFn(`${pbUrl}/api/collections/${PACKAGES}`, {
    headers: authHeaders(token),
  });
  if (head.ok) {
    // Best-effort: ensure newer fields exist on a pre-existing collection.
    // (PB collection updates are idempotent on POST? No — but we can PATCH.)
    await ensurePackagesFields(fetchFn, token, pbUrl);
    return { ok: true };
  }
  if (head.status !== 404) {
    return { ok: false, status: head.status, body: await head.text() };
  }
  const create = await fetchFn(`${pbUrl}/api/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: PACKAGES,
      type: 'base',
      fields: [
        { name: 'short_code', type: 'text', required: true, maxLength: 32 },
        { name: 'wsap_json', type: 'json', required: true, maxSize: 5_000_000 },
        { name: 'sender_email', type: 'email', required: true },
        { name: 'cell_key_fingerprint', type: 'text', required: false, maxLength: 64 },
        { name: 'origin_app_id', type: 'text', required: false, maxLength: 64 },
        { name: 'app_name', type: 'text', required: false, maxLength: 200 },
        { name: 'domain', type: 'text', required: false, maxLength: 200 },
        { name: 'version', type: 'number', min: 1 },
        { name: 'passphrase_hash', type: 'text', required: false, maxLength: 256 },
        { name: 'passphrase_salt', type: 'text', required: false, maxLength: 64 },
        { name: 'expires_at', type: 'date', required: true },
        { name: 'install_token', type: 'text', required: true, maxLength: 64 },
        { name: 'install_count', type: 'number', min: 0 },
        { name: 'max_installs', type: 'number', min: 1 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${PACKAGES}_short_code ON ${PACKAGES} (short_code)`,
        `CREATE INDEX idx_${PACKAGES}_sender ON ${PACKAGES} (sender_email, created DESC)`,
        `CREATE INDEX idx_${PACKAGES}_origin ON ${PACKAGES} (cell_key_fingerprint, origin_app_id)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

/**
 * Idempotently widen the collection schema on a pre-existing
 * deployment. PB tolerates duplicate field names in the request
 * (it dedupes); we PATCH the collection definition with the union
 * of old + new fields. If any of the new fields already exist it's
 * a no-op.
 */
async function ensurePackagesFields(
  fetchFn: typeof fetch,
  token: string,
  pbUrl: string,
): Promise<void> {
  const get = await fetchFn(`${pbUrl}/api/collections/${PACKAGES}`, {
    headers: authHeaders(token),
  });
  if (!get.ok) return;
  const body = (await get.json()) as { fields?: { name: string }[]; id?: string };
  const have = new Set((body.fields ?? []).map((f) => f.name));
  const want: {
    name: string;
    type: string;
    required?: boolean;
    maxLength?: number;
    min?: number;
  }[] = [
    { name: 'cell_key_fingerprint', type: 'text', maxLength: 64 },
    { name: 'origin_app_id', type: 'text', maxLength: 64 },
    { name: 'app_name', type: 'text', maxLength: 200 },
    { name: 'domain', type: 'text', maxLength: 200 },
    { name: 'version', type: 'number', min: 1 },
    { name: 'passphrase_hash', type: 'text', maxLength: 256 },
    { name: 'passphrase_salt', type: 'text', maxLength: 64 },
  ];
  const missing = want.filter((w) => !have.has(w.name));
  if (missing.length === 0) return;
  const merged = [...(body.fields ?? []), ...missing];
  await fetchFn(`${pbUrl}/api/collections/${PACKAGES}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ fields: merged }),
  });
}

function generateShortCode(): string {
  // 8 chars lowercase alphanumeric (~36^8 = 2.8e12 space).
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function hashPassphrase(passphrase: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(passphrase, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash, salt };
}

export function verifyPassphrase(passphrase: string, hash: string, salt: string): boolean {
  if (!hash || !salt) return false;
  let computed: Buffer;
  try {
    computed = scryptSync(passphrase, salt, 64, { N: 16384, r: 8, p: 1 });
  } catch {
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  if (computed.length !== expected.length) return false;
  // Constant-time compare via HMAC-of-bytes trick (timingSafeEqual would work too).
  const key = randomBytes(32);
  return (
    createHmac('sha256', key).update(computed).digest('hex') ===
    createHmac('sha256', key).update(expected).digest('hex')
  );
}

export interface UpsertPackageInput {
  readonly bundle: unknown;
  readonly senderEmail: string;
  readonly cellKeyFingerprint: string;
  readonly originAppId: string;
  readonly appName: string;
  readonly domain: string;
  readonly passphrase?: string | undefined;
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly pbUrl?: string;
}

export type UpsertPackageResult =
  | {
      readonly ok: true;
      readonly action: 'created' | 'updated';
      readonly shortCode: string;
      readonly installToken: string;
      readonly expiresAt: string;
      readonly version: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Upsert a package by (cell_key_fingerprint, origin_app_id):
 *   - if an existing row matches → PATCH (preserve short_code +
 *     install_token, bump version, refresh wsap_json, refresh
 *     expires_at, optionally overwrite passphrase).
 *   - else INSERT a new row.
 *
 * `passphrase` is plaintext; this function hashes it. Pass `undefined`
 * to leave the existing passphrase untouched on update or to publish
 * without a passphrase on create. Pass the empty string to clear an
 * existing passphrase on update.
 */
export async function upsertPackage(input: UpsertPackageInput): Promise<UpsertPackageResult> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const ensured = await ensurePackagesCollection(input.fetchFn, input.token, pbUrl);
  if (!ensured.ok) return { ok: false, reason: `collection-ensure: HTTP ${ensured.status}` };

  // Look up by (cell_key_fingerprint, origin_app_id).
  const filter = `cell_key_fingerprint = ${JSON.stringify(input.cellKeyFingerprint)} && origin_app_id = ${JSON.stringify(input.originAppId)}`;
  const lookup = await input.fetchFn(
    `${pbUrl}/api/collections/${PACKAGES}/records?${new URLSearchParams({
      perPage: '1',
      sort: '-created',
      filter,
    })}`,
    { headers: authHeaders(input.token) },
  );
  if (!lookup.ok) {
    return { ok: false, reason: `lookup: HTTP ${lookup.status}` };
  }
  const body = (await lookup.json()) as { items?: readonly PackageRow[] };
  const existing = body.items && body.items.length > 0 ? body.items[0] : null;

  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  if (existing) {
    // PATCH — preserve short_code + install_token; bump version.
    const nextVersion = (existing.version ?? 1) + 1;
    const update: Record<string, unknown> = {
      wsap_json: input.bundle,
      sender_email: input.senderEmail.trim().toLowerCase(),
      app_name: input.appName,
      domain: input.domain,
      version: nextVersion,
      expires_at: expiresAt,
    };
    if (input.passphrase !== undefined) {
      if (input.passphrase === '') {
        update['passphrase_hash'] = '';
        update['passphrase_salt'] = '';
      } else {
        const { hash, salt } = hashPassphrase(input.passphrase);
        update['passphrase_hash'] = hash;
        update['passphrase_salt'] = salt;
      }
    }
    const patch = await input.fetchFn(
      `${pbUrl}/api/collections/${PACKAGES}/records/${existing.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(input.token),
        body: JSON.stringify(update),
      },
    );
    if (!patch.ok) {
      return {
        ok: false,
        reason: `package-update: HTTP ${patch.status} ${(await patch.text()).slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      action: 'updated',
      shortCode: existing.short_code,
      installToken: existing.install_token,
      expiresAt,
      version: nextVersion,
    };
  }

  // INSERT new row.
  let shortCode = generateShortCode();
  const installToken = randomToken(16);
  const passphraseFields: Record<string, string> = {};
  if (input.passphrase && input.passphrase.length > 0) {
    const { hash, salt } = hashPassphrase(input.passphrase);
    passphraseFields['passphrase_hash'] = hash;
    passphraseFields['passphrase_salt'] = salt;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const create = await input.fetchFn(`${pbUrl}/api/collections/${PACKAGES}/records`, {
      method: 'POST',
      headers: authHeaders(input.token),
      body: JSON.stringify({
        short_code: shortCode,
        wsap_json: input.bundle,
        sender_email: input.senderEmail.trim().toLowerCase(),
        cell_key_fingerprint: input.cellKeyFingerprint,
        origin_app_id: input.originAppId,
        app_name: input.appName,
        domain: input.domain,
        version: 1,
        expires_at: expiresAt,
        install_token: installToken,
        install_count: 0,
        max_installs: DEFAULT_MAX_INSTALLS,
        ...passphraseFields,
      }),
    });
    if (create.ok) {
      return { ok: true, action: 'created', shortCode, installToken, expiresAt, version: 1 };
    }
    const txt = await create.text();
    if (create.status === 400 && /short_code.*unique|already exists/i.test(txt)) {
      shortCode = generateShortCode();
      continue;
    }
    return {
      ok: false,
      reason: `package-create: HTTP ${create.status} ${txt.slice(0, 200)}`,
    };
  }
  return { ok: false, reason: 'short-code-collision-exceeded-retries' };
}

export interface PutPackageInput {
  readonly bundle: unknown;
  readonly senderEmail: string;
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly pbUrl?: string;
}

export type PutPackageResult =
  | {
      readonly ok: true;
      readonly shortCode: string;
      readonly installToken: string;
      readonly expiresAt: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Legacy non-upsert path retained so older code paths and tests
 * don't break. New code should call upsertPackage.
 */
export async function putPackage(input: PutPackageInput): Promise<PutPackageResult> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const ensured = await ensurePackagesCollection(input.fetchFn, input.token, pbUrl);
  if (!ensured.ok) return { ok: false, reason: `collection-ensure: HTTP ${ensured.status}` };

  let shortCode = generateShortCode();
  const installToken = randomToken(16);
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 4; attempt++) {
    const create = await input.fetchFn(`${pbUrl}/api/collections/${PACKAGES}/records`, {
      method: 'POST',
      headers: authHeaders(input.token),
      body: JSON.stringify({
        short_code: shortCode,
        wsap_json: input.bundle,
        sender_email: input.senderEmail.trim().toLowerCase(),
        version: 1,
        expires_at: expiresAt,
        install_token: installToken,
        install_count: 0,
        max_installs: DEFAULT_MAX_INSTALLS,
      }),
    });
    if (create.ok) return { ok: true, shortCode, installToken, expiresAt };
    const txt = await create.text();
    if (create.status === 400 && /short_code.*unique|already exists/i.test(txt)) {
      shortCode = generateShortCode();
      continue;
    }
    return {
      ok: false,
      reason: `package-create: HTTP ${create.status} ${txt.slice(0, 200)}`,
    };
  }
  return { ok: false, reason: 'short-code-collision-exceeded-retries' };
}

export interface GetPackageInput {
  readonly shortCode: string;
  readonly installToken?: string;
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly pbUrl?: string;
}

export type GetPackageResult =
  | {
      readonly ok: true;
      readonly row: {
        readonly id: string;
        readonly shortCode: string;
        readonly senderEmail: string;
        readonly bundle: unknown;
        readonly expiresAt: string;
        readonly installCount: number;
        readonly maxInstalls: number;
        readonly version: number;
        readonly cellKeyFingerprint: string;
        readonly originAppId: string;
        readonly appName: string;
        readonly domain: string;
        readonly passphraseHash: string;
        readonly passphraseSalt: string;
      };
    }
  | { readonly ok: false; readonly reason: string };

export async function getPackage(input: GetPackageInput): Promise<GetPackageResult> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const params = new URLSearchParams({
    perPage: '1',
    filter: `short_code = ${JSON.stringify(input.shortCode)}`,
  });
  const r = await input.fetchFn(`${pbUrl}/api/collections/${PACKAGES}/records?${params}`, {
    headers: authHeaders(input.token),
  });
  if (!r.ok) return { ok: false, reason: `package-lookup: HTTP ${r.status}` };
  const body = (await r.json()) as { items?: readonly PackageRow[] };
  const row = body.items && body.items.length > 0 ? body.items[0] : null;
  if (!row) return { ok: false, reason: 'not-found' };
  if (input.installToken !== undefined && input.installToken !== row.install_token) {
    return { ok: false, reason: 'token-mismatch' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (row.install_count >= row.max_installs) {
    return { ok: false, reason: 'install-limit-reached' };
  }
  return {
    ok: true,
    row: {
      id: row.id,
      shortCode: row.short_code,
      senderEmail: row.sender_email,
      bundle: row.wsap_json,
      expiresAt: row.expires_at,
      installCount: row.install_count,
      maxInstalls: row.max_installs,
      version: row.version ?? 1,
      cellKeyFingerprint: row.cell_key_fingerprint ?? '',
      originAppId: row.origin_app_id ?? '',
      appName: row.app_name ?? '',
      domain: row.domain ?? '',
      passphraseHash: row.passphrase_hash ?? '',
      passphraseSalt: row.passphrase_salt ?? '',
    },
  };
}

export interface ListBySenderInput {
  readonly senderEmail: string;
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly pbUrl?: string;
}

export interface ListedPackage {
  readonly id: string;
  readonly shortCode: string;
  readonly installToken: string;
  readonly appName: string;
  readonly domain: string;
  readonly version: number;
  readonly patronSentence: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly installCount: number;
  readonly maxInstalls: number;
  readonly hasPassphrase: boolean;
  readonly originAppId: string;
}

export type ListBySenderResult =
  | { readonly ok: true; readonly items: readonly ListedPackage[] }
  | { readonly ok: false; readonly reason: string };

/**
 * List every package authored by a sender (verified email). Used
 * by the author dashboard at app.webspinner.ai/me.
 */
export async function listPackagesBySender(input: ListBySenderInput): Promise<ListBySenderResult> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const ensured = await ensurePackagesCollection(input.fetchFn, input.token, pbUrl);
  if (!ensured.ok) return { ok: false, reason: `collection-ensure: HTTP ${ensured.status}` };

  const email = input.senderEmail.trim().toLowerCase();
  const params = new URLSearchParams({
    perPage: '200',
    sort: '-updated',
    filter: `sender_email = ${JSON.stringify(email)}`,
  });
  const r = await input.fetchFn(`${pbUrl}/api/collections/${PACKAGES}/records?${params}`, {
    headers: authHeaders(input.token),
  });
  if (!r.ok) return { ok: false, reason: `list: HTTP ${r.status}` };
  const body = (await r.json()) as { items?: readonly PackageRow[] };
  const items: ListedPackage[] = (body.items ?? []).map((row) => {
    const bundle = row.wsap_json as Record<string, unknown> | null;
    const createdFrom =
      bundle && typeof bundle === 'object'
        ? ((bundle['createdFrom'] ?? {}) as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      shortCode: row.short_code,
      installToken: row.install_token,
      appName: row.app_name ?? '',
      domain: row.domain ?? '',
      version: row.version ?? 1,
      patronSentence:
        typeof createdFrom['patronSentence'] === 'string'
          ? (createdFrom['patronSentence'] as string)
          : '',
      createdAt: row.created,
      updatedAt: row.updated,
      expiresAt: row.expires_at,
      installCount: row.install_count ?? 0,
      maxInstalls: row.max_installs ?? DEFAULT_MAX_INSTALLS,
      hasPassphrase: Boolean(row.passphrase_hash),
      originAppId: row.origin_app_id ?? '',
    };
  });
  return { ok: true, items };
}

export async function bumpInstallCount(
  fetchFn: typeof fetch,
  token: string,
  rowId: string,
  pbUrl: string = PB_URL_DEFAULT,
): Promise<void> {
  await fetchFn(`${pbUrl}/api/collections/${PACKAGES}/records/${rowId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ 'install_count+': 1 }),
  });
}
