import { redirect } from '@sveltejs/kit';
import { clearSession } from '$lib/server/session.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = () => {
  // Direct GET to /logout — just clear and bounce.
  throw redirect(303, '/');
};

export const actions: Actions = {
  default: ({ cookies, url }) => {
    clearSession(cookies, url);
    throw redirect(303, '/');
  },
};
