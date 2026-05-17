/**
 * Webspinner Application Package registry — server-side store for
 * patron-uploaded `.wsap` bundles, keyed by a short URL-friendly
 * code. The receiving patron arrives at /install/<shortCode> with
 * the install_token (sent only to the original patron's email);
 * the surface page renders a preview + Install button.
 *
 * Collection shape:
 *   wp_app_packages
 *     short_code          text  (6-12 chars, lowercase alphanumeric)
 *     wsap_json           json  (the full signed bundle)
 *     sender_email        email
 *     created_at          autodate (system)
 *     expires_at          date  (default 30d)
 *     install_token       text  (32 hex; secret in the install URL)
 *     install_count       number
 *     max_installs        number (default 5)
 */

import { randomBytes } from 'node:crypto';
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
  if (head.ok) return { ok: true };
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
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

function generateShortCode(): string {
  // 8 chars lowercase alphanumeric; ~36^8 = 2.8 * 10^12 space; collision
  // probability is negligible at modest volume.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // omit 0/o/i/l/1 for readability
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
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

export async function putPackage(input: PutPackageInput): Promise<PutPackageResult> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const ensured = await ensurePackagesCollection(input.fetchFn, input.token, pbUrl);
  if (!ensured.ok) return { ok: false, reason: `collection-ensure: HTTP ${ensured.status}` };

  // Retry on rare short_code collisions (collection has a unique index).
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
        expires_at: expiresAt,
        install_token: installToken,
        install_count: 0,
        max_installs: DEFAULT_MAX_INSTALLS,
      }),
    });
    if (create.ok) {
      return { ok: true, shortCode, installToken, expiresAt };
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

export interface GetPackageInput {
  readonly shortCode: string;
  /**
   * If provided, must match the row's install_token. When absent
   * (e.g. an admin preview), the call still resolves but the caller
   * is expected to enforce its own auth.
   */
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
    },
  };
}

export async function bumpInstallCount(
  fetchFn: typeof fetch,
  token: string,
  rowId: string,
  pbUrl: string = PB_URL_DEFAULT,
): Promise<void> {
  // Fire-and-forget — the install already succeeded; a missed bump
  // just slightly under-counts.
  await fetchFn(`${pbUrl}/api/collections/${PACKAGES}/records/${rowId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ 'install_count+': 1 }),
  });
}
