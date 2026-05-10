// Email-verification token store. Lives in PocketBase as a base collection
// `wp_email_verifications` — separate from `users` so we don't risk
// clobbering its auth schema on field upgrades, and so we can index by
// token + expire old rows without touching auth state.
//
// Schema: name (unique, =user email), token (unique, 64-char hex),
// expires_at (RFC 3339), consumed_at (RFC 3339, NULL until used).

import { randomBytes } from 'node:crypto';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_email_verifications';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface VerificationRow {
  readonly id: string;
  readonly user_email: string;
  readonly token: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
}

export type VerifyError =
  | { readonly kind: 'token-not-found' }
  | { readonly kind: 'token-expired' }
  | { readonly kind: 'token-consumed' }
  | { readonly kind: 'backend'; readonly status: number; readonly body: string };

export type VerifyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: VerifyError };

function authHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

export async function ensureVerificationsCollection(
  fetchFn: typeof fetch,
  pbToken: string,
): Promise<VerifyResult<void>> {
  const head = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}`, {
    headers: authHeaders(pbToken),
  });
  if (head.ok) return { ok: true, value: undefined };
  if (head.status !== 404) {
    return { ok: false, error: { kind: 'backend', status: head.status, body: await head.text() } };
  }
  const create = await fetchFn(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: authHeaders(pbToken),
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'user_email', type: 'text', required: true, max: 254 },
        { name: 'token', type: 'text', required: true, unique: true, max: 64 },
        { name: 'expires_at', type: 'text', required: true, max: 32 },
        { name: 'consumed_at', type: 'text', required: false, max: 32 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${COLLECTION}_token ON ${COLLECTION} (token)`,
        `CREATE INDEX idx_${COLLECTION}_email ON ${COLLECTION} (user_email)`,
      ],
    }),
  });
  if (!create.ok) {
    return { ok: false, error: { kind: 'backend', status: create.status, body: await create.text() } };
  }
  return { ok: true, value: undefined };
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export interface IssueOptions {
  /** When true, invalidate any prior unconsumed tokens for this email. */
  readonly invalidatePrior?: boolean;
}

export async function issueVerificationToken(
  fetchFn: typeof fetch,
  pbToken: string,
  userEmail: string,
  options: IssueOptions = {},
): Promise<VerifyResult<{ token: string; expiresAt: string }>> {
  if (options.invalidatePrior) {
    // Mark any unconsumed tokens for this email as consumed (so they can't be used).
    const filter = encodeURIComponent(`user_email = "${userEmail}" && consumed_at = ""`);
    const list = await fetchFn(
      `${PB_URL}/api/collections/${COLLECTION}/records?filter=${filter}&perPage=50`,
      { headers: authHeaders(pbToken) },
    );
    if (list.ok) {
      const body = (await list.json()) as { items: readonly VerificationRow[] };
      const now = new Date().toISOString();
      for (const row of body.items) {
        await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records/${row.id}`, {
          method: 'PATCH',
          headers: authHeaders(pbToken),
          body: JSON.stringify({ consumed_at: now }),
        });
      }
    }
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const create = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    headers: authHeaders(pbToken),
    body: JSON.stringify({
      user_email: userEmail.toLowerCase(),
      token,
      expires_at: expiresAt,
      consumed_at: '',
    }),
  });
  if (!create.ok) {
    return { ok: false, error: { kind: 'backend', status: create.status, body: await create.text() } };
  }
  return { ok: true, value: { token, expiresAt } };
}

export async function consumeVerificationToken(
  fetchFn: typeof fetch,
  pbToken: string,
  token: string,
): Promise<VerifyResult<{ userEmail: string }>> {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { ok: false, error: { kind: 'token-not-found' } };
  }
  const filter = encodeURIComponent(`token = "${token}"`);
  const lookup = await fetchFn(
    `${PB_URL}/api/collections/${COLLECTION}/records?filter=${filter}&perPage=1`,
    { headers: authHeaders(pbToken) },
  );
  if (!lookup.ok) {
    return { ok: false, error: { kind: 'backend', status: lookup.status, body: await lookup.text() } };
  }
  const body = (await lookup.json()) as { items: readonly VerificationRow[] };
  const row = body.items?.[0];
  if (!row) return { ok: false, error: { kind: 'token-not-found' } };
  if (row.consumed_at && row.consumed_at.length > 0) {
    return { ok: false, error: { kind: 'token-consumed' } };
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    return { ok: false, error: { kind: 'token-expired' } };
  }
  // Mark consumed.
  const now = new Date().toISOString();
  const patch = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records/${row.id}`, {
    method: 'PATCH',
    headers: authHeaders(pbToken),
    body: JSON.stringify({ consumed_at: now }),
  });
  if (!patch.ok) {
    return { ok: false, error: { kind: 'backend', status: patch.status, body: await patch.text() } };
  }
  return { ok: true, value: { userEmail: row.user_email } };
}

/** Find the user record by email, return id, then PATCH `verified=true`. */
export async function markUserVerified(
  fetchFn: typeof fetch,
  pbToken: string,
  email: string,
): Promise<VerifyResult<{ userId: string }>> {
  const filter = encodeURIComponent(`email = "${email.toLowerCase()}"`);
  const lookup = await fetchFn(
    `${PB_URL}/api/collections/users/records?filter=${filter}&perPage=1`,
    { headers: authHeaders(pbToken) },
  );
  if (!lookup.ok) {
    return { ok: false, error: { kind: 'backend', status: lookup.status, body: await lookup.text() } };
  }
  const body = (await lookup.json()) as { items: readonly { id: string }[] };
  const user = body.items?.[0];
  if (!user) return { ok: false, error: { kind: 'token-not-found' } };
  const patch = await fetchFn(`${PB_URL}/api/collections/users/records/${user.id}`, {
    method: 'PATCH',
    headers: authHeaders(pbToken),
    body: JSON.stringify({ verified: true }),
  });
  if (!patch.ok) {
    return { ok: false, error: { kind: 'backend', status: patch.status, body: await patch.text() } };
  }
  return { ok: true, value: { userId: user.id } };
}
