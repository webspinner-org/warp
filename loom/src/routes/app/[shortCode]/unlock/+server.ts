/**
 * POST /app/[shortCode]/unlock?t=<install_token>
 *
 * Body: { passphrase: string }
 *
 * Validates a Webbase passphrase. Rate-limited 3/min per IP+code.
 * Returns { ok } on success; on failure { ok:false, reason }.
 *
 * On success this endpoint does NOT mint a server cookie — the
 * client only uses it to gate showing the Open button. The actual
 * security boundary remains the Cell that imports the bundle. The
 * passphrase is a friction layer, not a cryptographic seal.
 */

import { error, json } from '@sveltejs/kit';
import { getPackage } from '$lib/server/wsap-registry.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from './$types.js';

interface BucketEntry {
  count: number;
  windowStart: number;
}
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 3;
const buckets = new Map<string, BucketEntry>();

function rateCheck(key: string): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_MAX_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

export const POST: RequestHandler = async ({
  params,
  url,
  request,
  fetch: f,
  getClientAddress,
}) => {
  const shortCode = params.shortCode ?? '';
  const installToken = url.searchParams.get('t') ?? '';
  if (!shortCode || !installToken) throw error(400, 'shortCode and t required');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const passphrase = typeof b['passphrase'] === 'string' ? (b['passphrase'] as string) : '';
  if (!passphrase) return json({ ok: false, reason: 'passphrase-empty' }, { status: 400 });

  let ip = 'unknown';
  try {
    ip = getClientAddress();
  } catch {
    /* not available in all adapters */
  }
  if (!rateCheck(`${ip}|${shortCode}`)) {
    return json({ ok: false, reason: 'rate-limited' }, { status: 429 });
  }

  const pbToken = await loomPbToken(f);
  if (!pbToken) throw error(500, 'PB auth failed');

  const pkg = await getPackage({
    shortCode,
    installToken,
    fetchFn: f,
    token: pbToken,
  });
  if (!pkg.ok) {
    return json(
      { ok: false, reason: pkg.reason },
      { status: pkg.reason === 'not-found' ? 404 : 410 },
    );
  }

  if (!pkg.row.passphraseHash || !pkg.row.passphraseSalt) {
    return json({ ok: false, reason: 'no-passphrase-set' }, { status: 400 });
  }

  // Constant-time comparison (scrypt + timingSafeEqual).
  const computed = scryptSync(passphrase, pkg.row.passphraseSalt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(pkg.row.passphraseHash, 'hex');
  const okBytes = computed.length === expected.length && timingSafeEqual(computed, expected);
  if (!okBytes) {
    return json({ ok: false, reason: 'passphrase-mismatch' }, { status: 401 });
  }
  return json({ ok: true });
};
