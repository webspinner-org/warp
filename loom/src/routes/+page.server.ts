/**
 * GET / — host-aware root.
 *
 * On `app.webspinner.ai` (the Webbase runtime/publishing surface),
 * the root IS the author dashboard — same load + render as /me.
 * On the operator Loom (any other host), the root stays as the
 * branded splash → /login.
 *
 * Host detection reads `x-forwarded-host` directly from the
 * request headers because the demo Loom is run with `ORIGIN` set,
 * which makes `event.url.host` always reflect the bound origin
 * rather than the public hostname.
 */

import type { PageServerLoad } from './$types.js';
import { loadAuthorDashboard, type DashboardData } from '$lib/server/author-dashboard.js';

const APP_HOSTS = new Set(['app.webspinner.ai']);

export type RootData = { mode: 'splash' } | ({ mode: 'dashboard' } & DashboardData);

export const load: PageServerLoad = async ({ request, cookies, fetch: f }) => {
  // Cloudflare passes the public hostname through as `host`; the
  // `x-forwarded-host` header isn't set in our tunnel config. Read
  // `host` directly. `event.url.host` cannot be used: the demo Loom
  // is started with ORIGIN=http://127.0.0.1:3010 (for CSRF), which
  // overrides the URL host to the bound origin regardless of the
  // request's public hostname.
  const rawHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const hostName = rawHost.toLowerCase().split(':')[0];
  if (!APP_HOSTS.has(hostName)) {
    return { mode: 'splash' as const };
  }
  const dash = await loadAuthorDashboard(cookies, f);
  return { mode: 'dashboard' as const, ...dash };
};
