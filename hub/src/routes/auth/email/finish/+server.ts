/**
 * POST /auth/email/finish — { email, code }
 *
 * Verifies the 6-digit code against the pending cookie minted by
 * /auth/email/start. On success: mints the warp_hub session cookie
 * (7-day TTL) keyed on the verified email, clears the pending
 * cookie, returns { ok, email, isWizard }. Wizard status is derived
 * fresh on every request from the allowlist, so changes there
 * propagate without rotating cookies.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
  clearPendingCookie,
  readPendingCookie,
  verifyPendingCookie,
} from '$lib/server/hub-email-verify.js';
import { setHubCookie } from '$lib/server/hub-session.js';
import { isWizard } from '$lib/server/wizard-allowlist.js';

export const POST: RequestHandler = async ({ request, cookies }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  const email = String((body as { email?: unknown })?.email ?? '');
  const code = String((body as { code?: unknown })?.code ?? '');

  const pending = readPendingCookie(cookies);
  const result = verifyPendingCookie(pending, email, code);
  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, { status: 400 });
  }

  setHubCookie(cookies, result.email);
  clearPendingCookie(cookies);
  return json({ ok: true, email: result.email, isWizard: isWizard(result.email) });
};
