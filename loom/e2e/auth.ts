import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Read PocketBase superuser credentials from the bootstrap dir.
 * Process-level cache — read once per worker.
 */
let cached: { email: string; password: string } | undefined;

export function getCreds(): { email: string; password: string } {
  if (cached) return cached;
  const email = process.env['WARP_PB_EMAIL'];
  const password = process.env['WARP_PB_PASSWORD'];
  if (!email || !password) {
    throw new Error(
      'Missing WARP_PB_EMAIL / WARP_PB_PASSWORD env vars. ' +
        'Set them via the test runner script (pnpm test:e2e), ' +
        'which reads ~/.warp/bootstrap/pb-email and ~/.warp/bootstrap/pb-password.',
    );
  }
  cached = { email, password };
  return cached;
}

/**
 * Sign in (as registered Wizard or bootstrap superuser), ending up on /admin.
 *
 * The login form uses non-standard input names — `wizard_id` and
 * `passphrase` (with CSS-masked text) — so Safari's Keychain heuristics
 * never treat this as a sign-in form. See `~/warp/loom/src/routes/login/+page.svelte`.
 */
export async function signIn(page: Page): Promise<void> {
  const { email, password } = getCreds();
  await page.goto('/login');
  await page.locator('input[name="wizard_id"]').fill(email);
  await page.locator('input[name="passphrase"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin$/);
}
