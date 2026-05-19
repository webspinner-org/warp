/**
 * Hub server hooks.
 *
 * - Decodes the `warp_hub` cookie on every request and attaches the
 *   resolved session to `event.locals.user` (or null if unauth).
 * - Applies the same "do-not-cache dynamic HTML" hardening pattern
 *   used by the Loom (OWASP cache-and-refresh + post-signout safety).
 */

import type { Handle } from '@sveltejs/kit';
import { getHubSession } from '$lib/server/hub-session.js';
import { isWizard } from '$lib/server/wizard-allowlist.js';

const NEVER_CACHE = 'private, no-cache, no-store, must-revalidate';

function shouldDisableCache(response: Response, pathname: string): boolean {
  if (response.headers.has('cache-control')) return false;
  if (pathname.startsWith('/_app/immutable/')) return false;
  if (pathname === '/favicon.ico') return false;
  if (pathname.startsWith('/splash')) return false;
  return true;
}

export const handle: Handle = async ({ event, resolve }) => {
  const session = getHubSession(event.cookies);
  event.locals.user = session
    ? {
        sub: session.sub,
        email: session.email,
        name: session.name,
        picture: session.picture,
        isWizard: isWizard(session.email),
      }
    : null;

  const response = await resolve(event);
  if (shouldDisableCache(response, event.url.pathname)) {
    response.headers.set('cache-control', NEVER_CACHE);
    response.headers.set('pragma', 'no-cache');
    response.headers.set('expires', '0');
  }
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  return response;
};
