import type { Handle, HandleServerError } from '@sveltejs/kit';

/**
 * Hardening per OWASP cache-and-refresh guidance + SvelteKit production
 * recommendations:
 *
 *  1. Authenticated/dynamic HTML pages MUST NOT be cached by the browser
 *     or any intermediary. Otherwise back-button + refresh after sign-out
 *     can re-render previous content. Set
 *     `Cache-Control: private, no-cache, no-store, must-revalidate`
 *     plus `Pragma: no-cache` and `Expires: 0` for compatibility.
 *  2. Hashed immutable assets under `/_app/immutable/` are content-addressed
 *     and safe to cache aggressively — SvelteKit already sets
 *     `cache-control: public, max-age=31536000, immutable` on those.
 *     This middleware only touches HTML / JSON / form-action responses.
 *  3. The Spinner thumbnail route sets its own `Cache-Control`; it is
 *     intentionally cacheable (5 minutes) — leave it alone.
 *  4. Server-side errors are logged with full detail server-side and
 *     surfaced to the user as a redacted message that the branded
 *     `+error.svelte` page can render with dignity.
 */

const NEVER_CACHE = 'private, no-cache, no-store, must-revalidate';

function shouldDisableCache(response: Response, pathname: string): boolean {
  // Skip if a downstream route already set Cache-Control deliberately.
  if (response.headers.has('cache-control')) return false;
  // Skip immutable assets (SvelteKit serves them with their own headers).
  if (pathname.startsWith('/_app/immutable/')) return false;
  // Skip favicon/static if any (low risk, public).
  if (pathname === '/favicon.ico') return false;
  // Skip Spinner thumbnail route (its own cache headers, intentional).
  if (pathname.includes('/thumbnail')) return false;
  return true;
}

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  if (shouldDisableCache(response, event.url.pathname)) {
    response.headers.set('cache-control', NEVER_CACHE);
    response.headers.set('pragma', 'no-cache');
    response.headers.set('expires', '0');
  }

  // Always-on security headers — cheap, broadly compatible.
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');

  return response;
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  // Log full detail server-side. The launchd LaunchAgent funnels stderr
  // to ~/Library/Application Support/Webspinner Foundation/Loom/logs/loom.err.log.
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  console.error(`[loom-error] status=${status} path=${event.url.pathname} method=${event.request.method}\n${detail}`);

  // Return only what the +error.svelte page can render — never leak stack traces.
  return {
    message:
      status >= 500
        ? "Something on the Loom's side. Refresh; if it persists, sign out and back in."
        : message,
  };
};
