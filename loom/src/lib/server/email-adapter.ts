/**
 * Email adapter — pluggable transport for outbound mail.
 *
 * v0.1 ships a dev-mode console+file adapter that writes every
 * outbound email to a JSONL log (`~/.warp/email-outbox.jsonl`) and
 * to stdout so the Wizard can read 6-digit codes during testing.
 *
 * The interface (`sendEmail`) is the swap-point for plugging in a
 * real provider (Resend, Postmark, SES, etc.) — implementations only
 * need to honour the contract and return ok/err.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type EmailSendResult =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly reason: string };

const OUTBOX_PATH = join(homedir(), '.warp', 'email-outbox.jsonl');

/**
 * Dev adapter — logs to JSONL + stdout. Use for local development
 * and the demo until a real provider is wired.
 */
export async function sendEmailDev(msg: EmailMessage): Promise<EmailSendResult> {
  const messageId = 'dev-' + Math.random().toString(36).slice(2, 14);
  const entry = {
    timestamp: new Date().toISOString(),
    messageId,
    to: msg.to,
    subject: msg.subject,
    textBody: msg.textBody,
    headers: msg.headers ?? {},
  };
  try {
    await mkdir(dirname(OUTBOX_PATH), { recursive: true });
    await appendFile(OUTBOX_PATH, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    return { ok: false, reason: 'outbox-write-failed: ' + (e as Error).message };
  }
  // intentional dev-mode trace
  console.log(
    `\n[email-dev] → ${msg.to}\n[email-dev] subj: ${msg.subject}\n[email-dev] body:\n${msg.textBody}\n[email-dev] outbox: ${OUTBOX_PATH}\n`,
  );
  return { ok: true, messageId };
}

/**
 * Top-level send — dispatches to the configured adapter.
 *   WARP_EMAIL_PROVIDER=dev (default) → sendEmailDev (JSONL outbox)
 *   WARP_EMAIL_PROVIDER=resend        → delegates to email.ts (real
 *                                       transactional send through
 *                                       Resend; key resolved via
 *                                       resolveResendKey)
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const provider = process.env['WARP_EMAIL_PROVIDER'] ?? 'dev';
  if (provider === 'dev') return sendEmailDev(msg);
  if (provider === 'resend') {
    const { sendEmail: sendEmailResend } = await import('./email.js');
    const html =
      msg.htmlBody && msg.htmlBody.length > 0
        ? msg.htmlBody
        : msg.textBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    const r = await sendEmailResend(globalThis.fetch, {
      to: msg.to,
      subject: msg.subject,
      text: msg.textBody,
      html,
    });
    if (r.ok) return { ok: true, messageId: r.id };
    if (r.kind === 'unsent-no-credentials') return { ok: false, reason: 'resend-no-credentials' };
    return { ok: false, reason: `resend-send-failed: ${r.detail.slice(0, 200)}` };
  }
  return {
    ok: false,
    reason: `email-provider-unknown: ${provider}`,
  };
}
