/**
 * POST /auth/email/start — { email }
 *
 * Generates a 6-digit code, signs a pending cookie, sends the code
 * to the patron's email via Resend. Returns { ok } so the UI can
 * advance to the code-prompt step. Failure to send returns 502
 * with a useful reason so the patron isn't stranded.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { generateCode, mintPendingCookie, setPendingCookie } from '$lib/server/hub-email-verify.js';
import { buildHubCodeEmail, sendEmail } from '$lib/server/resend.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request, cookies, fetch: f }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  const email = ((body as { email?: unknown })?.email ?? '') as string;
  const normalized = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    return json({ ok: false, reason: 'email-malformed' }, { status: 400 });
  }

  const code = generateCode();
  const cookieValue = mintPendingCookie(normalized, code);
  setPendingCookie(cookies, cookieValue);

  const tpl = buildHubCodeEmail({ code, email: normalized });
  const send = await sendEmail(
    { to: normalized, subject: tpl.subject, html: tpl.html, text: tpl.text },
    f,
  );
  if (!send.ok) {
    if (send.kind === 'unsent-no-credentials') {
      return json(
        {
          ok: false,
          reason: 'Resend not configured on this server. Set RESEND_API_KEY in the hub plist.',
        },
        { status: 503 },
      );
    }
    return json(
      { ok: false, reason: `send-failed: ${send.detail.slice(0, 200)}` },
      { status: 502 },
    );
  }
  return json({ ok: true });
};
