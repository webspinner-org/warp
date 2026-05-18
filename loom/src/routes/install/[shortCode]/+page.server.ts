/**
 * GET /install/[shortCode]?t=<install_token>
 *
 * Legacy path — `/install/` was renamed to `/app/` when the
 * portability artifact became "Webbase" instead of WSAP. Email links
 * issued before the rename land here; we 301 them to the new path so
 * the original message still works.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, url }) => {
  const shortCode = params.shortCode ?? '';
  const installToken = url.searchParams.get('t') ?? '';
  const qs = installToken ? `?t=${encodeURIComponent(installToken)}` : '';
  throw redirect(301, `/app/${shortCode}${qs}`);
};
