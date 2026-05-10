// Server-side PocketBase client. PocketBase runs on Kepler co-located with the
// Loom; default URL is localhost. Override with WARP_PB_URL when the Loom
// is deployed on a different host than its Grimoire (rare during bootstrap).

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

export interface SuperuserAuthResult {
  readonly token: string;
  readonly record: {
    readonly id: string;
    readonly email: string;
    readonly created: string;
    readonly updated: string;
  };
}

export type AuthError =
  | { readonly kind: 'invalid-credentials' }
  | { readonly kind: 'network'; readonly status?: number };

export type AuthResult =
  | { readonly ok: true; readonly auth: SuperuserAuthResult }
  | { readonly ok: false; readonly error: AuthError };

/** Authenticate as a superuser via password. Returns the PB-issued JWT. */
export async function authSuperuser(
  fetchFn: typeof fetch,
  identity: string,
  password: string,
): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetchFn(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password }),
    });
  } catch {
    return { ok: false, error: { kind: 'network' } };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { ok: false, error: { kind: 'invalid-credentials' } };
  }
  if (!res.ok) {
    return { ok: false, error: { kind: 'network', status: res.status } };
  }
  const auth = (await res.json()) as SuperuserAuthResult;
  return { ok: true, auth };
}

/**
 * Authenticate as the Loom server's own bootstrap superuser identity using
 * env-var credentials (`WARP_PB_EMAIL` / `WARP_PB_PASSWORD`). Returns the
 * fresh PB token used for backend operations on behalf of the Loom —
 * vault reads, audit writes, silk pattern writes — *not* on behalf of
 * the human Wizard. Keeps the session cookie as proof-of-auth only.
 */
export async function loomPbToken(fetchFn: typeof fetch): Promise<string | null> {
  const email = process.env['WARP_PB_EMAIL'];
  const password = process.env['WARP_PB_PASSWORD'];
  if (!email || !password) return null;
  const result = await authSuperuser(fetchFn, email, password);
  if (!result.ok) return null;
  return result.auth.token;
}

/** Verify a PB token is still valid; returns the refreshed record. */
export async function refreshSuperuser(fetchFn: typeof fetch, token: string): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetchFn(`${PB_URL}/api/collections/_superusers/auth-refresh`, {
      method: 'POST',
      headers: { Authorization: token },
    });
  } catch {
    return { ok: false, error: { kind: 'network' } };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: { kind: 'invalid-credentials' } };
  }
  if (!res.ok) {
    return { ok: false, error: { kind: 'network', status: res.status } };
  }
  const auth = (await res.json()) as SuperuserAuthResult;
  return { ok: true, auth };
}
