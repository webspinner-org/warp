import { redirect } from '@sveltejs/kit';
import { loomPbToken } from '$lib/server/pocketbase.js';
import {
  consumeVerificationToken,
  ensureVerificationsCollection,
  markUserVerified,
} from '$lib/server/verifications.js';
import { getSession, clearSession } from '$lib/server/session.js';
import { refreshUser } from '$lib/server/users.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ url, fetch, cookies }) => {
  const token = url.searchParams.get('token') ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { state: 'invalid' as const, message: 'This verification link is malformed.' };
  }

  const pbToken = await loomPbToken(fetch);
  if (!pbToken) {
    return { state: 'error' as const, message: 'Loom server credentials are missing.' };
  }
  await ensureVerificationsCollection(fetch, pbToken);

  const consume = await consumeVerificationToken(fetch, pbToken, token);
  if (!consume.ok) {
    let message: string;
    switch (consume.error.kind) {
      case 'token-not-found':
        message = 'This verification link is not recognized.';
        break;
      case 'token-expired':
        message = 'This verification link has expired. Sign in and request a new one.';
        break;
      case 'token-consumed':
        message = 'This link was already used. If you still need to verify, request a new one.';
        break;
      default:
        message = 'Something went wrong on our side. Try again in a moment.';
    }
    return { state: 'invalid' as const, message };
  }

  // Mark user verified.
  const mark = await markUserVerified(fetch, pbToken, consume.value.userEmail);
  if (!mark.ok) {
    return {
      state: 'error' as const,
      message: 'Verification token accepted, but updating the user record failed. Try signing in again.',
    };
  }

  // If the visitor already has a session, refresh it so the new verified state
  // propagates and the auth gate lets them through.
  const session = getSession(cookies);
  if (session?.collection === 'users') {
    const refresh = await refreshUser(fetch, session.token);
    if (!refresh.ok) clearSession(cookies, url);
  }

  return { state: 'verified' as const, email: consume.value.userEmail };
};
