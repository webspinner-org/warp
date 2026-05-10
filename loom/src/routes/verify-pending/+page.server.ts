import { redirect, fail } from '@sveltejs/kit';
import { getSession, clearSession } from '$lib/server/session.js';
import { refreshUser } from '$lib/server/users.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  ensureVerificationsCollection,
  issueVerificationToken,
} from '$lib/server/verifications.js';
import { sendEmail, buildVerificationEmail } from '$lib/server/email.js';
import type { Actions, PageServerLoad } from './$types.js';

const RESEND_RATE: Map<string, number> = new Map();
const RESEND_INTERVAL_MS = 60_000;

export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
  const session = getSession(cookies);
  if (!session || session.collection !== 'users') {
    // Either not authenticated or already a superuser (which is verified by definition).
    throw redirect(303, '/login');
  }

  const refresh = await refreshUser(fetch, session.token);
  if (!refresh.ok) {
    clearSession(cookies, url);
    throw redirect(303, '/login');
  }

  // If verified, send them on to /admin.
  if (refresh.value.record.verified) {
    throw redirect(303, '/admin');
  }

  const pendingUrl = cookies.get('wp_pending_verify_url') ?? null;
  return {
    user: {
      email: refresh.value.record.email,
      name: refresh.value.record.name ?? '',
    },
    bootstrap: {
      // When Resend isn't vault-configured, the original verify URL is shown
      // inline so the Wizard can verify *himself* on first registration.
      // This vanishes the moment `vault://_self/resend-api-key` is set.
      pendingVerifyUrl: pendingUrl,
    },
  };
};

export const actions: Actions = {
  resend: async ({ cookies, fetch, url }) => {
    const session = getSession(cookies);
    if (!session || session.collection !== 'users') {
      return fail(401, { error: 'Not authenticated.' });
    }
    const refresh = await refreshUser(fetch, session.token);
    if (!refresh.ok) return fail(401, { error: 'Session expired.' });
    if (refresh.value.record.verified) {
      throw redirect(303, '/admin');
    }
    const email = refresh.value.record.email;

    const last = RESEND_RATE.get(email) ?? 0;
    const now = Date.now();
    if (now - last < RESEND_INTERVAL_MS) {
      const wait = Math.ceil((RESEND_INTERVAL_MS - (now - last)) / 1000);
      return fail(429, { error: `Wait ${wait} seconds before requesting another email.` });
    }
    RESEND_RATE.set(email, now);

    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return fail(500, { error: 'Loom server credentials missing.' });

    await ensureVerificationsCollection(fetch, pbToken);
    const issue = await issueVerificationToken(fetch, pbToken, email, { invalidatePrior: true });
    if (!issue.ok) return fail(500, { error: 'Could not issue a new verification token.' });

    const verifyUrl = `${url.origin}/verify?token=${issue.value.token}`;
    const body = buildVerificationEmail({
      toName: refresh.value.record.name ?? 'Wizard',
      verifyUrl,
    });
    const send = await sendEmail(fetch, {
      to: email,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });

    if (!send.ok) {
      if (send.kind === 'unsent-no-credentials') {
        cookies.set('wp_pending_verify_url', verifyUrl, {
          path: '/verify-pending',
          httpOnly: true,
          secure: url.protocol === 'https:',
          sameSite: 'strict',
          maxAge: 60 * 60,
        });
        return { resent: 'bootstrap', verifyUrl };
      }
      // send-failed
      return fail(502, { error: `Email send failed: ${send.detail}.` });
    }
    return { resent: 'sent' };
  },
};
