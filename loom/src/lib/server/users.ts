// PocketBase `users` collection helpers — the canonical Wizard auth path.
//
// PocketBase's `users` collection is a default auth collection with:
//   createRule = ""              (anyone may register)
//   viewRule   = "id = @request.auth.id"  (own record only)
//   updateRule = "id = @request.auth.id"
//   deleteRule = "id = @request.auth.id"
//   listRule   = "id = @request.auth.id"
//
// We treat the `users` collection as the "regular" auth surface. The
// `_superusers` collection stays as the bootstrap-recovery surface — used
// only by the Loom server itself (env-var credentials in the LaunchAgent)
// for ensuring collections + reading the vault. Wizards sign in as users.

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

export interface UserAuthRecord {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
  readonly verified: boolean;
  readonly created: string;
  readonly updated: string;
}

export interface UserAuthResult {
  readonly token: string;
  readonly record: UserAuthRecord;
  readonly collection: 'users' | '_superusers';
}

export type UserError =
  | { readonly kind: 'invalid-credentials' }
  | { readonly kind: 'duplicate-email' }
  | { readonly kind: 'invalid-email' }
  | { readonly kind: 'invalid-password' }
  | { readonly kind: 'name-required' }
  | { readonly kind: 'password-mismatch' }
  | { readonly kind: 'honeypot' }
  | { readonly kind: 'not-verified' }
  | { readonly kind: 'network'; readonly status?: number };

export type UserResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: UserError };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 12; // Wizard-grade entropy floor; not arbitrary

export function validateEmail(s: string): boolean {
  return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
}

export function validatePassword(s: string): boolean {
  return typeof s === 'string' && s.length >= PASSWORD_MIN;
}

/**
 * Register a new Wizard. Creates a record in the `users` collection and
 * immediately authenticates them. Honeypot field `website` MUST be empty.
 *
 * Bot defense today: honeypot + rate limit (caller's responsibility).
 * Turnstile server-side verify is open work — when the secret lives in
 * the vault, a thin wrapper here invokes Cloudflare's siteverify endpoint.
 */
export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly passwordConfirm: string;
  readonly name: string;
  /** Honeypot field — bots fill it, humans don't. */
  readonly website?: string;
}

export async function registerUser(
  fetchFn: typeof fetch,
  input: RegisterInput,
): Promise<UserResult<UserAuthResult>> {
  if (input.website && input.website.length > 0) {
    return { ok: false, error: { kind: 'honeypot' } };
  }
  if (!validateEmail(input.email)) {
    return { ok: false, error: { kind: 'invalid-email' } };
  }
  if (!input.name || input.name.trim().length === 0) {
    return { ok: false, error: { kind: 'name-required' } };
  }
  if (!validatePassword(input.password)) {
    return { ok: false, error: { kind: 'invalid-password' } };
  }
  if (input.password !== input.passwordConfirm) {
    return { ok: false, error: { kind: 'password-mismatch' } };
  }

  // Create the record
  let createRes: Response;
  try {
    createRes = await fetchFn(`${PB_URL}/api/collections/users/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email.toLowerCase(),
        password: input.password,
        passwordConfirm: input.passwordConfirm,
        name: input.name.trim(),
        emailVisibility: false,
      }),
    });
  } catch {
    return { ok: false, error: { kind: 'network' } };
  }

  if (createRes.status === 400) {
    const body = (await createRes.json().catch(() => ({}))) as {
      data?: Record<string, { code?: string; message?: string }>;
    };
    const emailError = body.data?.['email'];
    if (emailError?.code === 'validation_not_unique') {
      return { ok: false, error: { kind: 'duplicate-email' } };
    }
    if (emailError) {
      return { ok: false, error: { kind: 'invalid-email' } };
    }
    return { ok: false, error: { kind: 'network', status: 400 } };
  }
  if (!createRes.ok) {
    return { ok: false, error: { kind: 'network', status: createRes.status } };
  }

  // Authenticate them
  return authUser(fetchFn, input.email, input.password);
}

/** Authenticate against the users collection. */
export async function authUser(
  fetchFn: typeof fetch,
  identity: string,
  password: string,
): Promise<UserResult<UserAuthResult>> {
  let res: Response;
  try {
    res = await fetchFn(`${PB_URL}/api/collections/users/auth-with-password`, {
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
  const body = (await res.json()) as { token: string; record: UserAuthRecord };
  return {
    ok: true,
    value: { token: body.token, record: body.record, collection: 'users' },
  };
}

/** Refresh a `users`-collection token; same shape as authUser's success. */
export async function refreshUser(
  fetchFn: typeof fetch,
  token: string,
): Promise<UserResult<UserAuthResult>> {
  let res: Response;
  try {
    res = await fetchFn(`${PB_URL}/api/collections/users/auth-refresh`, {
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
  const body = (await res.json()) as { token: string; record: UserAuthRecord };
  return {
    ok: true,
    value: { token: body.token, record: body.record, collection: 'users' },
  };
}

export function userErrorMessage(e: UserError): string {
  switch (e.kind) {
    case 'invalid-credentials':
      return 'Email or password is incorrect.';
    case 'duplicate-email':
      return 'An account with that email already exists. Try signing in.';
    case 'invalid-email':
      return 'That email address looks invalid.';
    case 'invalid-password':
      return `Password must be at least ${PASSWORD_MIN} characters.`;
    case 'name-required':
      return 'Please tell us what to call you.';
    case 'password-mismatch':
      return 'Passwords do not match.';
    case 'honeypot':
      return 'Submission rejected.'; // Don't tell bots they triggered it
    case 'not-verified':
      return 'Please verify your email before signing in.';
    case 'network':
      return `Backend unreachable${e.status ? ` (${e.status})` : ''}. Try again in a moment.`;
  }
}
