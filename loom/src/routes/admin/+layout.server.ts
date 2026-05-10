import { redirect } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { refreshSuperuser } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import { clearSession, getSession, setSession } from '$lib/server/session.js';
import type { LayoutServerLoad } from './$types.js';

const DEV_BYPASS_TOKEN = process.env['WARP_DEV_BYPASS_TOKEN'];

function checkDevBypass(headerValue: string | null): boolean {
  if (!DEV_BYPASS_TOKEN || !headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(DEV_BYPASS_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const load: LayoutServerLoad = async ({ cookies, fetch, url, request }) => {
  // Dev-only SSR auth bypass: a strong token in the X-Warp-Dev-Token
  // header, matching the WARP_DEV_BYPASS_TOKEN env var, lets internal
  // tooling (the Pablo critique loop) render admin pages without a user
  // session. Scoped to GET — form actions still require real auth.
  if (request.method === 'GET' && checkDevBypass(request.headers.get('x-warp-dev-token'))) {
    return {
      user: {
        email: 'dev-bypass@warp.local',
        id: 'dev-bypass',
        name: 'Dev Bypass',
        verified: true,
        kind: 'dev-bypass' as const,
      },
    };
  }

  const session = getSession(cookies);
  if (!session) {
    throw redirect(303, '/login');
  }

  if (session.collection === 'users') {
    const result = await refreshUser(fetch, session.token);
    if (!result.ok) {
      clearSession(cookies, url);
      throw redirect(303, '/login');
    }
    if (!result.value.record.verified) {
      throw redirect(303, '/verify-pending');
    }
    setSession(cookies, url, 'users', result.value.token);
    return {
      user: {
        email: result.value.record.email,
        id: result.value.record.id,
        name: result.value.record.name ?? '',
        verified: result.value.record.verified,
        kind: 'wizard' as const,
      },
    };
  }

  // _superusers — bootstrap-recovery surface; verified by definition.
  const result = await refreshSuperuser(fetch, session.token);
  if (!result.ok) {
    clearSession(cookies, url);
    throw redirect(303, '/login');
  }
  setSession(cookies, url, '_superusers', result.auth.token);
  return {
    user: {
      email: result.auth.record.email,
      id: result.auth.record.id,
      name: '',
      verified: true,
      kind: 'bootstrap-superuser' as const,
    },
  };
};
