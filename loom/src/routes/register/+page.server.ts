import { fail, redirect } from '@sveltejs/kit';
import { registerUser, userErrorMessage } from '$lib/server/users.js';
import { setSession, getSession } from '$lib/server/session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  ensureVerificationsCollection,
  issueVerificationToken,
} from '$lib/server/verifications.js';
import { sendEmail, buildVerificationEmail } from '$lib/server/email.js';
import type { Actions, PageServerLoad } from './$types.js';

const RATE: Map<string, { count: number; resetAt: number }> = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = RATE.get(ip);
  if (!e || e.resetAt < now) {
    RATE.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  e.count += 1;
  return e.count > RATE_MAX;
}

export const load: PageServerLoad = ({ cookies }) => {
  if (getSession(cookies)) {
    throw redirect(303, '/admin');
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, fetch, url, getClientAddress }) => {
    const ip = (() => {
      try {
        return getClientAddress();
      } catch {
        return 'unknown';
      }
    })();

    if (rateLimited(ip)) {
      return fail(429, { error: 'Too many attempts. Wait a minute and try again.', email: '', name: '' });
    }

    const data = await request.formData();
    const email = data.get('email')?.toString().trim() ?? '';
    const name = data.get('name')?.toString().trim() ?? '';
    const password = data.get('password')?.toString() ?? '';
    const passwordConfirm = data.get('password_confirm')?.toString() ?? '';
    const website = data.get('website')?.toString() ?? ''; // honeypot

    const result = await registerUser(fetch, { email, name, password, passwordConfirm, website });
    if (!result.ok) {
      const status = result.error.kind === 'network' ? 502 : 400;
      return fail(status, { error: userErrorMessage(result.error), email, name });
    }

    // Set the session — auth gate will redirect them to /verify-pending
    // until they confirm their email.
    setSession(cookies, url, 'users', result.value.token);

    // Issue verification token + send email (best-effort; bootstrap fallback
    // shows the verify URL inline if Resend isn't yet vault-configured).
    const pbToken = await loomPbToken(fetch);
    if (pbToken) {
      await ensureVerificationsCollection(fetch, pbToken);
      const issue = await issueVerificationToken(fetch, pbToken, result.value.record.email, {
        invalidatePrior: true,
      });
      if (issue.ok) {
        const verifyUrl = `${url.origin}/verify?token=${issue.value.token}`;
        const body = buildVerificationEmail({
          toName: result.value.record.name ?? 'Wizard',
          verifyUrl,
        });
        const send = await sendEmail(fetch, {
          to: result.value.record.email,
          subject: body.subject,
          html: body.html,
          text: body.text,
        });
        if (!send.ok && send.kind === 'unsent-no-credentials') {
          // Bootstrap fallback — the verify URL is set as a short-lived
          // cookie scoped to /verify-pending so the page can show it inline.
          cookies.set('wp_pending_verify_url', verifyUrl, {
            path: '/verify-pending',
            httpOnly: true,
            secure: url.protocol === 'https:',
            sameSite: 'strict',
            maxAge: 60 * 60,
          });
        }
      }
    }

    throw redirect(303, '/verify-pending');
  },
};
