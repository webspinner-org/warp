// Email send via Resend — used for identity verification today; expandable
// to other transactional shapes (welcome, federation invitations, etc.).
//
// API key is read from the vault at `vault://_self/resend-api-key`, falling
// back to the `RESEND_API_KEY` env var. When neither is present, the call
// returns an `unsent-no-credentials` result and the caller surfaces the
// verification URL inline as a bootstrap fallback so the Wizard can verify
// his own first registration without waiting on credentials in the vault.

import { listSecrets, type SecretRow } from './secrets.js';
import { decryptValue } from './crypto.js';
import { loomPbToken } from './pocketbase.js';

const RESEND_API = 'https://api.resend.com/emails';

export type EmailSendResult =
  | { readonly ok: true; readonly id: string; readonly via: 'resend' }
  | { readonly ok: false; readonly kind: 'unsent-no-credentials' }
  | {
      readonly ok: false;
      readonly kind: 'send-failed';
      readonly status?: number;
      readonly detail: string;
    };

export interface EmailSendInput {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
}

interface PBVaultRecord {
  readonly name: string;
  readonly ciphertext: string;
  readonly iv: string;
}

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

async function vaultLookup(
  fetchFn: typeof fetch,
  pbUrl: string,
  pbToken: string,
  masterKey: string,
  name: string,
): Promise<string | null> {
  try {
    const url = `${pbUrl}/api/collections/vault_secrets/records?filter=${encodeURIComponent(`name = "${name}"`)}&perPage=1`;
    const res = await fetchFn(url, { headers: { Authorization: pbToken } });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: readonly PBVaultRecord[] };
    const row = body.items?.[0];
    if (!row) return null;
    return await decryptValue(masterKey, { ciphertext: row.ciphertext, iv: row.iv });
  } catch {
    return null;
  }
}

/**
 * Resolve the Resend API key.
 *
 * 1. RESEND_API_KEY env (operator override / bootstrap fallback).
 * 2. Vault lookup. Default vault is the local PocketBase
 *    (WARP_PB_URL + WARP_PB_EMAIL/PASSWORD + WARP_VAULT_MASTER_KEY).
 *    Services whose data-PB and vault-PB differ (e.g., the demo Loom
 *    uses operator PB for vault, demo PB for data) set the
 *    WARP_VAULT_LOOKUP_* fall-throughs to point at the operator PB
 *    without changing their data-PB connection.
 * 3. null — the caller must surface the no-credentials path honestly.
 */
export async function resolveResendKey(fetchFn: typeof fetch): Promise<string | null> {
  const envKey = process.env['RESEND_API_KEY'];
  if (envKey && envKey.length > 0) return envKey;

  const vaultPbUrl = process.env['WARP_VAULT_LOOKUP_URL'] ?? PB_URL;
  const vaultEmail = process.env['WARP_VAULT_LOOKUP_EMAIL'] ?? process.env['WARP_PB_EMAIL'];
  const vaultPassword =
    process.env['WARP_VAULT_LOOKUP_PASSWORD'] ?? process.env['WARP_PB_PASSWORD'];
  const vaultKey =
    process.env['WARP_VAULT_LOOKUP_MASTER_KEY'] ?? process.env['WARP_VAULT_MASTER_KEY'];
  if (!vaultEmail || !vaultPassword || !vaultKey) return null;

  // Authenticate against the vault PB (might be the same as data PB,
  // might be a different host — service is responsible for the env).
  let pbToken: string | null;
  try {
    const authRes = await fetchFn(`${vaultPbUrl}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: vaultEmail, password: vaultPassword }),
    });
    if (!authRes.ok) return null;
    const body = (await authRes.json()) as { token?: string };
    pbToken = body.token ?? null;
  } catch {
    return null;
  }
  if (!pbToken) return null;

  void listSecrets;
  return await vaultLookup(fetchFn, vaultPbUrl, pbToken, vaultKey, 'resend-api-key');
}

void loomPbToken; // kept imported for potential future use; legacy local-vault helper

const FROM_EMAIL = process.env['WARP_FROM_EMAIL'] ?? 'foundation@webspinner.foundation';
const FROM_NAME = process.env['WARP_FROM_NAME'] ?? 'The Webspinner Foundation';

export async function sendEmail(
  fetchFn: typeof fetch,
  input: EmailSendInput,
): Promise<EmailSendResult> {
  const apiKey = await resolveResendKey(fetchFn);
  if (!apiKey) {
    return { ok: false, kind: 'unsent-no-credentials' };
  }
  let res: Response;
  try {
    res = await fetchFn(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: [input.replyTo] } : {}),
      }),
    });
  } catch (e) {
    return { ok: false, kind: 'send-failed', detail: (e as Error).message };
  }
  if (!res.ok) {
    return {
      ok: false,
      kind: 'send-failed',
      status: res.status,
      detail: await res.text(),
    };
  }
  const body = (await res.json()) as { id: string };
  return { ok: true, id: body.id, via: 'resend' };
}

/**
 * Build a verification email — branded, mobile-friendly, with a plain-text
 * fallback. Wow-as-Baseline (canon §17.5) applies to email templates too.
 */
export function buildVerificationEmail(args: {
  readonly toName: string;
  readonly verifyUrl: string;
}): { html: string; text: string; subject: string } {
  const { toName, verifyUrl } = args;
  const subject = 'Verify your email to weave with Warp';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0; padding:0; background:#0a0a0a; color:#f0f0f0; font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:48px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="display:inline-block; color:#c9a96a; font-size:1.4rem; font-weight:700; letter-spacing:0.22em;">WARP</span>
              <div style="color:#5fcfe0; font-size:0.7rem; letter-spacing:0.18em; text-transform:uppercase; margin-top:6px;">Webspinner Foundation</div>
            </td>
          </tr>
          <tr>
            <td style="background:#111; border:1px solid #1f1f1f; border-radius:10px; padding:32px 28px;">
              <h1 style="margin:0 0 16px; color:#c9a96a; font-size:1.4rem; font-weight:600; font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;">Welcome, ${escapeHtml(toName)}.</h1>
              <p style="margin:0 0 16px; color:#ccc; font-size:0.95rem; line-height:1.6;">
                You've started a Webspinner Foundation Cell. To finish — and to weave Spinners
                under your name — confirm this email belongs to you.
              </p>
              <p style="margin:0 0 24px; color:#ccc; font-size:0.95rem; line-height:1.6;">
                The link expires in 24 hours.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px 0 24px;">
                <tr>
                  <td align="center" bgcolor="#c9a96a" style="border-radius:6px;">
                    <a href="${escapeAttr(verifyUrl)}" style="display:inline-block; padding:12px 28px; color:#1a1306; font-size:0.95rem; font-weight:600; text-decoration:none; letter-spacing:0.02em;">Verify my email</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0; color:#777; font-size:0.78rem; line-height:1.55;">
                If the button doesn't work, paste this link into your browser:<br>
                <span style="color:#aaa; word-break:break-all;">${escapeHtml(verifyUrl)}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px; color:#666; font-size:0.72rem; line-height:1.55; text-align:center;">
              Didn't try to register? You can ignore this email — your address won't be added.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Welcome, ${toName}.`,
    '',
    `You've started a Webspinner Foundation Cell. Verify your email to finish:`,
    '',
    verifyUrl,
    '',
    `The link expires in 24 hours.`,
    '',
    `Didn't try to register? You can ignore this email.`,
    '',
    `— The Webspinner Foundation`,
  ].join('\n');

  return { html, text, subject };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export function unwrapSecretRow(_row: SecretRow): never {
  throw new Error('not implemented');
}
