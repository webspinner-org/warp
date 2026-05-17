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
 * Top-level send — dispatches to the configured adapter. When
 * WARP_EMAIL_PROVIDER is unset or equals 'dev', uses sendEmailDev.
 * Other values reserved for future providers.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const provider = process.env['WARP_EMAIL_PROVIDER'] ?? 'dev';
  if (provider === 'dev') return sendEmailDev(msg);
  return {
    ok: false,
    reason: `email-provider-unknown: ${provider} (only 'dev' is wired in v0.1)`,
  };
}
