/**
 * Email verification — 6-digit code, 10-minute TTL.
 *
 * The patron submits their email; the Loom generates a code, sends
 * it via the email adapter, and stores a pending row in
 * `wp_email_verifications` (lazy-created). The patron returns with
 * the code; the Loom validates and issues a verified-session ticket
 * that subsequent calls use to attest "this session belongs to
 * email X."
 *
 * Tickets are HMAC-signed (vault master key) and carry the verified
 * email + the session id they're bound to. They're short — 30
 * minutes — and one-use unless the consumer chooses to keep them.
 */

import { createHmac, randomBytes, randomInt } from 'node:crypto';

const VERIFICATIONS = 'wp_email_verifications' as const;
const CODE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 30 * 60 * 1000;

interface PBRow extends Record<string, unknown> {
  id: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}

interface VerificationRow extends PBRow {
  email: string;
  session_id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: token,
    'Content-Type': 'application/json',
  };
}

const PB_URL_DEFAULT = process.env['WARP_PB_URL'] ?? 'http://127.0.0.1:8091';

async function ensureVerificationsCollection(
  fetchFn: typeof fetch,
  token: string,
  pbUrl: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const head = await fetchFn(`${pbUrl}/api/collections/${VERIFICATIONS}`, {
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
      name: VERIFICATIONS,
      type: 'base',
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'session_id', type: 'text', required: true, maxLength: 128 },
        { name: 'code_hash', type: 'text', required: true, maxLength: 128 },
        { name: 'expires_at', type: 'date', required: true },
        { name: 'attempts', type: 'number', min: 0 },
        { name: 'consumed_at', type: 'date' },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE INDEX idx_${VERIFICATIONS}_session ON ${VERIFICATIONS} (session_id, created DESC)`,
      ],
    }),
  });
  if (!create.ok) return { ok: false, status: create.status, body: await create.text() };
  return { ok: true };
}

function hashCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

function generateCode(): string {
  // Six digits, zero-padded. randomInt avoids the modulo-bias issue
  // crypto.randomBytes(%1000000) has at the top of the range.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface StartVerifyInput {
  readonly email: string;
  readonly sessionId: string;
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly masterKey: string;
  readonly pbUrl?: string;
}

export type StartVerifyResult =
  | { readonly ok: true; readonly expiresAt: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Begin an email verification — generate a code, store its hash,
 * email the code to the patron.
 */
export async function startEmailVerify(input: StartVerifyInput): Promise<StartVerifyResult> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: 'email-malformed' };
  }
  if (!input.sessionId || input.sessionId.length > 128) {
    return { ok: false, reason: 'session-missing' };
  }

  const ensured = await ensureVerificationsCollection(input.fetchFn, input.token, pbUrl);
  if (!ensured.ok) return { ok: false, reason: `collection-ensure: HTTP ${ensured.status}` };

  const code = generateCode();
  const codeHash = hashCode(code, input.masterKey);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const createRes = await input.fetchFn(`${pbUrl}/api/collections/${VERIFICATIONS}/records`, {
    method: 'POST',
    headers: authHeaders(input.token),
    body: JSON.stringify({
      email,
      session_id: input.sessionId,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    }),
  });
  if (!createRes.ok) {
    return {
      ok: false,
      reason: `verification-create: HTTP ${createRes.status} ${(await createRes.text()).slice(0, 200)}`,
    };
  }

  // Send the email. The adapter is pluggable — in dev mode it logs
  // to a JSONL outbox file so the Wizard can read codes during
  // testing.
  const { sendEmail } = await import('./email-adapter.js');
  const send = await sendEmail({
    to: email,
    subject: `Your Webspinner verification code: ${code}`,
    textBody:
      `Your Webspinner verification code is: ${code}\n\n` +
      `This code expires in 10 minutes. Enter it on try.webspinner.ai to confirm your email and receive your application install link.\n\n` +
      `If you didn't request this code, you can safely ignore this email.\n\n` +
      `— The Weaver\n  Webspinner Foundation`,
  });
  if (!send.ok) return { ok: false, reason: `email-send: ${send.reason}` };
  return { ok: true, expiresAt };
}

export interface FinishVerifyInput {
  readonly email: string;
  readonly sessionId: string;
  readonly code: string;
  readonly fetchFn: typeof fetch;
  readonly token: string;
  readonly masterKey: string;
  readonly pbUrl?: string;
}

export type FinishVerifyResult =
  | { readonly ok: true; readonly ticket: string; readonly verifiedEmail: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Complete a verification — check the code against the latest
 * pending row, mark it consumed, return a signed ticket the caller
 * can pass back to gate "verified" operations.
 */
export async function finishEmailVerify(input: FinishVerifyInput): Promise<FinishVerifyResult> {
  const pbUrl = input.pbUrl ?? PB_URL_DEFAULT;
  const email = input.email.trim().toLowerCase();
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'code-format' };

  // Find the most recent unconsumed row for this {email, sessionId}.
  const filter = `email = ${JSON.stringify(email)} && session_id = ${JSON.stringify(input.sessionId)} && consumed_at = null`;
  const params = new URLSearchParams({
    perPage: '1',
    sort: '-created',
    filter,
  });
  const findRes = await input.fetchFn(
    `${pbUrl}/api/collections/${VERIFICATIONS}/records?${params}`,
    { headers: authHeaders(input.token) },
  );
  if (!findRes.ok) return { ok: false, reason: `verify-lookup: HTTP ${findRes.status}` };
  const body = (await findRes.json()) as { items?: readonly VerificationRow[] };
  const row = body.items && body.items.length > 0 ? body.items[0] : null;
  if (!row) return { ok: false, reason: 'no-pending-code' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'code-expired' };
  }
  if ((row.attempts ?? 0) >= 5) {
    return { ok: false, reason: 'too-many-attempts' };
  }
  const submittedHash = hashCode(code, input.masterKey);
  if (submittedHash !== row.code_hash) {
    // Increment attempts.
    await input.fetchFn(`${pbUrl}/api/collections/${VERIFICATIONS}/records/${row.id}`, {
      method: 'PATCH',
      headers: authHeaders(input.token),
      body: JSON.stringify({ attempts: (row.attempts ?? 0) + 1 }),
    });
    return { ok: false, reason: 'code-mismatch' };
  }

  // Mark consumed.
  await input.fetchFn(`${pbUrl}/api/collections/${VERIFICATIONS}/records/${row.id}`, {
    method: 'PATCH',
    headers: authHeaders(input.token),
    body: JSON.stringify({ consumed_at: new Date().toISOString() }),
  });

  // Mint a verified-session ticket: HMAC(email|sessionId|expiry).
  const ticket = mintTicket(email, input.sessionId, input.masterKey);
  return { ok: true, ticket, verifiedEmail: email };
}

export function mintTicket(email: string, sessionId: string, masterKey: string): string {
  const expiry = Date.now() + TICKET_TTL_MS;
  const payload = `${email}|${sessionId}|${expiry}`;
  const sig = createHmac('sha256', masterKey).update(payload).digest('hex').slice(0, 32);
  // Encode as base64-url so it's URL-safe.
  return Buffer.from(payload + '|' + sig).toString('base64url');
}

export type VerifyTicketResult =
  | { readonly ok: true; readonly email: string; readonly sessionId: string }
  | { readonly ok: false; readonly reason: string };

export function verifyTicket(ticket: string, masterKey: string): VerifyTicketResult {
  let decoded: string;
  try {
    decoded = Buffer.from(ticket, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'ticket-malformed' };
  }
  const parts = decoded.split('|');
  if (parts.length !== 4) return { ok: false, reason: 'ticket-malformed' };
  const [email, sessionId, expiryStr, sig] = parts as [string, string, string, string];
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) {
    return { ok: false, reason: 'ticket-expired' };
  }
  const expected = createHmac('sha256', masterKey)
    .update(`${email}|${sessionId}|${expiry}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return { ok: false, reason: 'ticket-invalid' };
  return { ok: true, email, sessionId };
}

// Token for use in URLs — used to gate registry GET so URLs aren't enumerable.
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}
