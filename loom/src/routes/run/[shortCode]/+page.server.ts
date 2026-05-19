/**
 * GET /run/[shortCode]?t=<install_token>
 *
 * In-browser Webbase runtime. Fetches the bundle, returns the
 * design + schema + branding to the client; the client renders
 * the screens and persists records in IndexedDB. No Cell round
 * trip on use — the Webbase runs entirely in the visitor's browser
 * after the initial bundle load.
 *
 * Passphrase: if set, the +page.svelte gates rendering behind the
 * /app/<code>/unlock POST. We still hand the bundle over the wire
 * since the passphrase isn't a cryptographic seal — it's a friction
 * layer on top of the shareable URL token.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { getPackage } from '$lib/server/wsap-registry.js';
import { loomPbToken } from '$lib/server/pocketbase.js';

export const load: PageServerLoad = async ({ params, url, fetch: f }) => {
  const shortCode = params.shortCode ?? '';
  const installToken = url.searchParams.get('t') ?? '';
  if (!shortCode) throw error(400, 'shortCode missing');
  if (!installToken) throw error(400, 'install token missing in URL (?t=…)');

  const pbToken = await loomPbToken(f);
  if (!pbToken) throw error(500, 'PB auth failed');
  const pkg = await getPackage({
    shortCode,
    installToken,
    fetchFn: f,
    token: pbToken,
  });
  if (!pkg.ok) {
    throw error(pkg.reason === 'not-found' ? 404 : 410, `Webbase: ${pkg.reason}`);
  }

  const bundle = pkg.row.bundle as Record<string, unknown>;
  const design = (bundle['design'] ?? {}) as Record<string, unknown>;
  const schema = (bundle['schema'] ?? {}) as Record<string, unknown>;
  const screensDraft = (design['screensDraft'] ?? {}) as Record<string, unknown>;

  return {
    shortCode: pkg.row.shortCode,
    installToken,
    version: pkg.row.version,
    locked: Boolean(pkg.row.passphraseHash),
    appName: pkg.row.appName || ((screensDraft['appName'] as string) ?? '(unnamed)'),
    domain: pkg.row.domain || ((screensDraft['domain'] as string) ?? ''),
    senderEmail: pkg.row.senderEmail,
    expiresAt: pkg.row.expiresAt,
    screensDraft,
    entities: (schema['entities'] ?? []) as readonly unknown[],
    branding: design['branding'] ?? null,
  };
};
