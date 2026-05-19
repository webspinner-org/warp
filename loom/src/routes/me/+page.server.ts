/**
 * GET /me — author dashboard (legacy path).
 *
 * Canonically the dashboard lives at the root of app.webspinner.ai;
 * /me is kept working for direct navigation and any URLs already in
 * the wild. Identical load behavior to /+page.server.ts.
 */

import type { PageServerLoad } from './$types.js';
import { loadAuthorDashboard } from '$lib/server/author-dashboard.js';

export const load: PageServerLoad = async ({ cookies, fetch: f }) => {
  return await loadAuthorDashboard(cookies, f);
};
