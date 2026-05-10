import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE = 'wp_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface CookieRequestUrl {
  readonly protocol: string;
}

export type SessionCollection = 'users' | '_superusers';

export interface ParsedSession {
  readonly collection: SessionCollection;
  readonly token: string;
}

/**
 * Cookie attributes are derived from the request URL's protocol so `set`
 * and `delete` always emit the same `Secure` flag. Safari (and other
 * spec-compliant browsers) reject `Set-Cookie: Secure` over HTTP entirely,
 * which otherwise breaks `delete` on an HTTP-only origin and silently
 * traps the browser in a redirect loop.
 */
function attrs(url: CookieRequestUrl) {
  return {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'strict' as const,
  };
}

export function setSession(
  cookies: Cookies,
  url: CookieRequestUrl,
  collection: SessionCollection,
  token: string,
): void {
  cookies.set(SESSION_COOKIE, `${collection}::${token}`, {
    ...attrs(url),
    maxAge: MAX_AGE_SECONDS,
  });
}

export function getSession(cookies: Cookies): ParsedSession | undefined {
  const raw = cookies.get(SESSION_COOKIE);
  if (!raw) return undefined;
  const idx = raw.indexOf('::');
  if (idx < 0) {
    // Legacy cookie — bootstrap session before the collection prefix landed.
    return { collection: '_superusers', token: raw };
  }
  const collection = raw.slice(0, idx);
  const token = raw.slice(idx + 2);
  if (collection !== 'users' && collection !== '_superusers') return undefined;
  return { collection, token };
}

/**
 * Clear the session cookie. Url parameter is REQUIRED so the cookie's
 * `Secure` flag matches what was used at set time. Mismatched attributes
 * cause Safari to reject the deletion and trap the browser in a redirect
 * loop on HTTP origins.
 */
export function clearSession(cookies: Cookies, url: CookieRequestUrl): void {
  cookies.delete(SESSION_COOKIE, attrs(url));
}
