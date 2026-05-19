/**
 * Resend transport for the Webspinner Hub. The API key is resolved
 * via `resolveResendKey()` — env-var first (`RESEND_API_KEY`), then
 * the warp vault (`resend-api-key` in `vault_secrets`, decrypted
 * with `WARP_VAULT_MASTER_KEY`). The vault is the canonical path
 * per WARP-CANON §17.2; env-var is the operator override.
 *
 * Other env vars:
 *   - WARP_FROM_EMAIL  — defaults to foundation@forms.webspinner.org
 *   - WARP_FROM_NAME   — defaults to "The Webspinner Foundation"
 *
 * If no key is available from either source, sendEmail returns an
 * unsent-no-credentials result so the surface can render an honest
 * "Resend not configured" message rather than pretending a code
 * was sent.
 */

import { resolveResendKey } from './vault-fetch.js';

const RESEND_API = 'https://api.resend.com/emails';

export type SendResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly kind: 'unsent-no-credentials' }
  | {
      readonly ok: false;
      readonly kind: 'send-failed';
      readonly status?: number;
      readonly detail: string;
    };

export interface SendInput {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

function fromHeader(): string {
  const email = process.env['WARP_FROM_EMAIL'] ?? 'foundation@forms.webspinner.org';
  const name = process.env['WARP_FROM_NAME'] ?? 'The Webspinner Foundation';
  return `${name} <${email}>`;
}

export async function sendEmail(
  input: SendInput,
  fetchFn: typeof fetch = fetch,
): Promise<SendResult> {
  const apiKey = await resolveResendKey(fetchFn);
  if (!apiKey || apiKey.length === 0) return { ok: false, kind: 'unsent-no-credentials' };

  let res: Response;
  try {
    res = await fetchFn(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
  } catch (err) {
    return { ok: false, kind: 'send-failed', detail: (err as Error).message };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, kind: 'send-failed', status: res.status, detail: detail.slice(0, 400) };
  }
  const body = (await res.json()) as { id: string };
  return { ok: true, id: body.id };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/**
 * Build the verification email body — Silicon Forest themed, plain-text
 * fallback included. The code is the only payload.
 */
export function buildHubCodeEmail(args: { code: string; email: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const { code, email } = args;
  const subject = `Your Webspinner Hub sign-in code: ${code}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#131e16;color:#e8e4d4;font-family:-apple-system,'SF Pro Display',system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#131e16;">
    <tr><td align="center" style="padding:48px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <span style="display:inline-block;color:#e8e4d4;font-size:1.3rem;font-weight:600;letter-spacing:0.005em;">Webspinner <span style="color:#4ad57a;">Hub</span></span>
          <div style="color:#8a958b;font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;margin-top:6px;">Sign-in code</div>
        </td></tr>
        <tr><td style="background:#1c2920;border:1px solid #2d4234;border-radius:12px;padding:32px 28px;text-align:center;">
          <p style="margin:0 0 14px;color:#c5c3b3;font-size:0.96rem;line-height:1.55;">Enter this code on the hub to finish signing in:</p>
          <div style="font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:2.2rem;letter-spacing:0.22em;color:#4ad57a;background:#243329;border:1px solid #2d4234;border-radius:10px;padding:14px 18px;margin:6px 0 18px;display:inline-block;">${escapeHtml(code)}</div>
          <p style="margin:0;color:#8a958b;font-size:0.84rem;line-height:1.55;">The code expires in 10 minutes. Requested by <span style="color:#c5c3b3;">${escapeHtml(email)}</span>.</p>
        </td></tr>
        <tr><td style="padding-top:24px;color:#6b7a6b;font-size:0.72rem;line-height:1.55;text-align:center;">
          Didn't try to sign in? You can ignore this email — your address won't be added.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Webspinner Hub — sign-in code`,
    ``,
    `Enter this code on the hub to finish signing in:`,
    ``,
    `    ${code}`,
    ``,
    `The code expires in 10 minutes. Requested by ${email}.`,
    ``,
    `Didn't try to sign in? You can ignore this email.`,
  ].join('\n');

  return { subject, html, text };
}
