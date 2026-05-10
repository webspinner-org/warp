import { fail, redirect } from '@sveltejs/kit';
import { authSuperuser, refreshSuperuser } from '$lib/server/pocketbase.js';
import { authUser, refreshUser } from '$lib/server/users.js';
import { setSession, getSession, clearSession } from '$lib/server/session.js';
import type { Actions, PageServerLoad } from './$types.js';

/**
 * State management discipline: validate the session BEFORE redirecting.
 * If the cookie is present but stale (deleted user, expired token,
 * malformed payload), clear it and render the form. Never blindly trust
 * cookie presence — that creates redirect loops when /admin can't refresh
 * the same session.
 */
export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
  const session = getSession(cookies);
  if (!session) {
    return {};
  }

  if (session.collection === 'users') {
    const result = await refreshUser(fetch, session.token);
    if (result.ok) {
      throw redirect(303, '/admin');
    }
  } else {
    const result = await refreshSuperuser(fetch, session.token);
    if (result.ok) {
      throw redirect(303, '/admin');
    }
  }

  // Session present but invalid — clear and render the form.
  clearSession(cookies, url);
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, fetch, url }) => {
    const data = await request.formData();
    // Field names are deliberately non-standard (`wizard_id`, `passphrase`)
    // so Safari Keychain doesn't bind autofill to this admin sign-in form.
    // The visible labels still say "Email" / "Password".
    const email = data.get('wizard_id')?.toString().trim() ?? '';
    const password = data.get('passphrase')?.toString() ?? '';

    if (!email || !password) {
      return fail(400, { error: 'Email and password are required.', email });
    }

    const userResult = await authUser(fetch, email, password);
    if (userResult.ok) {
      setSession(cookies, url, 'users', userResult.value.token);
      throw redirect(303, '/admin');
    }

    if (userResult.error.kind === 'invalid-credentials') {
      const superResult = await authSuperuser(fetch, email, password);
      if (superResult.ok) {
        setSession(cookies, url, '_superusers', superResult.auth.token);
        throw redirect(303, '/admin');
      }
      return fail(401, { error: 'Email or password is incorrect.', email });
    }

    return fail(502, { error: 'Backend unreachable. Try again in a moment.', email });
  },
};
