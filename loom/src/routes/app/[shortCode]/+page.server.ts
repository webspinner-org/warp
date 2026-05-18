/**
 * GET /app/[shortCode]?t=<install_token>
 *
 * Public landing for a published Webbase. Reads the bundle from the
 * registry, renders a preview, and (if a passphrase is set) gates
 * Open behind an unlock dialog.
 *
 * Auth: the URL token is the capability. We do NOT require a Loom
 * session to view this page (the recipient may have no Cell of
 * their own). The author can still view their own Webbase from
 * /me — their author cookie + the row's sender_email are matched
 * implicitly via the same install_token (the dashboard exposes it).
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
  const createdBy = (bundle['createdBy'] ?? {}) as Record<string, unknown>;
  const createdFrom = (bundle['createdFrom'] ?? {}) as Record<string, unknown>;
  const design = (bundle['design'] ?? {}) as Record<string, unknown>;
  const screensDraft = (design['screensDraft'] ?? {}) as Record<string, unknown>;
  const schema = (bundle['schema'] ?? {}) as Record<string, unknown>;
  const entities = Array.isArray(schema['entities']) ? schema['entities'] : [];

  return {
    shortCode: pkg.row.shortCode,
    installToken,
    expiresAt: pkg.row.expiresAt,
    installsRemaining: Math.max(0, pkg.row.maxInstalls - pkg.row.installCount),
    senderEmail: pkg.row.senderEmail,
    version: pkg.row.version,
    locked: Boolean(pkg.row.passphraseHash),
    appName:
      pkg.row.appName ||
      (typeof screensDraft['appName'] === 'string'
        ? (screensDraft['appName'] as string)
        : '(unnamed)'),
    domain:
      pkg.row.domain ||
      (typeof screensDraft['domain'] === 'string' ? (screensDraft['domain'] as string) : ''),
    patronSentence:
      typeof createdFrom['patronSentence'] === 'string'
        ? (createdFrom['patronSentence'] as string)
        : '',
    createdAt:
      typeof createdFrom['createdAt'] === 'string' ? (createdFrom['createdAt'] as string) : '',
    cellName:
      typeof createdBy['cellName'] === 'string'
        ? (createdBy['cellName'] as string)
        : 'unknown cell',
    cellKeyFingerprint:
      typeof createdBy['cellKeyFingerprint'] === 'string'
        ? (createdBy['cellKeyFingerprint'] as string)
        : '',
    spinnerBundleName:
      typeof createdFrom['spinnerBundleName'] === 'string'
        ? (createdFrom['spinnerBundleName'] as string)
        : '',
    spinnerBundleVersion:
      typeof createdFrom['spinnerBundleVersion'] === 'string'
        ? (createdFrom['spinnerBundleVersion'] as string)
        : '',
    entities: entities.map((e) => {
      const o = e as Record<string, unknown>;
      const flds = Array.isArray(o['fields']) ? (o['fields'] as readonly unknown[]) : [];
      const lks = Array.isArray(o['links']) ? (o['links'] as readonly unknown[]) : [];
      return {
        name: typeof o['name'] === 'string' ? (o['name'] as string) : '',
        fieldCount: flds.length,
        linkCount: lks.length,
      };
    }),
  };
};
