/**
 * Google OAuth 2.0 helpers — the hub's sole authentication path
 * for MVP-1.
 *
 * Flow:
 *   1. /auth/google/start  → 302 to Google's authorize endpoint,
 *      carrying `state` (CSRF nonce) and `scope=openid email profile`.
 *   2. /auth/google/callback → receives `code` and `state`, validates
 *      state against the cookie, exchanges code for an id_token,
 *      verifies the id_token, extracts user identity.
 *
 * id_token verification uses Google's `tokeninfo` endpoint
 *   GET https://oauth2.googleapis.com/tokeninfo?id_token=...
 * which Google supplies for low-volume servers. It echoes the
 * verified payload (sub, email, email_verified, aud, name, picture)
 * and 4xx's on any invalid token. Local JWKS verification is a
 * future optimization.
 */

import { randomBytes } from 'node:crypto';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

export interface OAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export function loadOAuthConfig(): OAuthConfig | null {
  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
  const redirectUri = process.env['GOOGLE_OAUTH_REDIRECT_URI'];
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

export function buildAuthorizeUrl(cfg: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

export interface TokenResponse {
  readonly id_token: string;
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly token_type?: string;
}

export type ExchangeResult =
  | { readonly ok: true; readonly token: TokenResponse }
  | { readonly ok: false; readonly reason: string };

export async function exchangeCodeForTokens(
  cfg: OAuthConfig,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  let res: Response;
  try {
    res = await fetchFn(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}` };
  }
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, reason: `token: HTTP ${res.status} ${txt.slice(0, 200)}` };
  }
  const json = (await res.json()) as TokenResponse;
  if (!json || typeof json.id_token !== 'string' || json.id_token.length === 0) {
    return { ok: false, reason: 'token: no id_token in response' };
  }
  return { ok: true, token: json };
}

export interface VerifiedIdToken {
  readonly sub: string;
  readonly email: string;
  readonly email_verified: boolean;
  readonly aud: string;
  readonly iss: string;
  readonly name?: string;
  readonly picture?: string;
  readonly exp: number;
}

export type VerifyResult =
  | { readonly ok: true; readonly claims: VerifiedIdToken }
  | { readonly ok: false; readonly reason: string };

export async function verifyIdToken(
  cfg: OAuthConfig,
  idToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<VerifyResult> {
  const url = `${TOKENINFO}?id_token=${encodeURIComponent(idToken)}`;
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'GET' });
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}` };
  }
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, reason: `verify: HTTP ${res.status} ${txt.slice(0, 200)}` };
  }
  const claims = (await res.json()) as Record<string, unknown>;
  // tokeninfo returns aud/iss/sub/email/email_verified/name/picture/exp.
  if (claims['aud'] !== cfg.clientId) {
    return { ok: false, reason: 'verify: aud-mismatch' };
  }
  const iss = String(claims['iss'] ?? '');
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    return { ok: false, reason: 'verify: iss-unexpected' };
  }
  const sub = String(claims['sub'] ?? '');
  const email = String(claims['email'] ?? '');
  if (!sub || !email) {
    return { ok: false, reason: 'verify: missing-fields' };
  }
  // `email_verified` comes back as the string "true"/"false" from
  // tokeninfo. Coerce.
  const ev = claims['email_verified'];
  const emailVerified = ev === true || ev === 'true';
  if (!emailVerified) {
    return { ok: false, reason: 'verify: email-not-verified' };
  }
  const exp = Number(claims['exp'] ?? 0);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return { ok: false, reason: 'verify: token-expired' };
  }
  return {
    ok: true,
    claims: {
      sub,
      email,
      email_verified: emailVerified,
      aud: String(claims['aud']),
      iss,
      name: typeof claims['name'] === 'string' ? (claims['name'] as string) : undefined,
      picture: typeof claims['picture'] === 'string' ? (claims['picture'] as string) : undefined,
      exp,
    },
  };
}
