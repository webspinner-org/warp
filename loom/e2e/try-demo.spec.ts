import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * try-demo.spec.ts — end-to-end Playwright run for the public demo at
 * https://try.webspinner.ai.
 *
 * The standard project config (e2e/playwright.config.ts) points at
 * the local Loom on port 4173. This spec overrides baseURL via the
 * env var WARP_E2E_BASE_URL=https://try.webspinner.ai when invoked.
 *
 * What it does:
 *   1. Loads the splash, dismisses it, opens the Database Application
 *      tile, types the bookkeeping sentence.
 *   2. Watches the Observatory phases tick over time.
 *   3. Screenshots every ~5s for the first 90s, then every 10s up to
 *      the propose timeout (~5 min).
 *   4. When the result lands, screenshots: success path (clarifications
 *      modal with palette swatches) OR failure path (retry CTA).
 *   5. If success: answers branding-choice, runs refine, waits, then
 *      build, then exercises the app.
 *
 * Screenshots land in ~/Desktop/playwright-try/<timestamp>/<step>.png
 * so the Wizard can review them directly.
 *
 * This spec is meant to be invoked manually, not in the CI batch.
 * Run with:
 *   WARP_E2E_BASE_URL=https://try.webspinner.ai \
 *     ./node_modules/.bin/playwright test e2e/try-demo.spec.ts \
 *     --project=chromium --headed=false --timeout=600000
 */

const SHOT_DIR = join(
  homedir(),
  'Desktop',
  'playwright-try',
  String(new Date().toISOString().replace(/[:.]/g, '-')),
);
mkdirSync(SHOT_DIR, { recursive: true });

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });

  console.log(`[shot] ${name} → ${path}`);
}

test.describe('try.webspinner.ai — patron loop end-to-end', () => {
  test.setTimeout(600_000);

  test('bookkeeping sentence → screens preview → branding → build → use', async ({ page }) => {
    await page.goto('/');
    await shot(page, '01-landing-with-splash');

    // Dismiss the splash overlay (centered modal over the live page,
    // per the splash-overlay design rule).
    const splashClose = page
      .locator('[data-splash-close], .splash-modal .close-button, button:has-text("Enter")')
      .first();
    if ((await splashClose.count()) > 0) {
      await splashClose.click({ trial: false }).catch(() => {
        /* splash already dismissed or missing; carry on */
      });
    }
    await page.waitForTimeout(500);
    await shot(page, '02-landing');

    // Open the Database Application tile from the menu.
    const dbTile = page.locator('text=Database Application').first();
    await dbTile.waitFor({ timeout: 15_000 });
    await dbTile.click();
    await shot(page, '03-db-tile-clicked');

    // The chat input becomes active; type the bookkeeping sentence.
    const chatInput = page.locator('input[type="text"], textarea').first();
    await chatInput.waitFor({ timeout: 10_000 });
    await chatInput.fill('I want to keep track of my small-business bookkeeping.');
    await shot(page, '04-sentence-typed');
    await chatInput.press('Enter');

    // The Observatory takes over. Watch the phases tick for up to
    // 5 minutes, capturing screenshots periodically.
    await page.waitForTimeout(2_000);
    await shot(page, '05-observatory-up');

    const deadlineMs = Date.now() + 5 * 60_000;
    let i = 0;
    let landed = false;
    while (Date.now() < deadlineMs) {
      i += 1;
      const interval = i < 12 ? 5_000 : 10_000;
      await page.waitForTimeout(interval);
      await shot(page, `06-progress-${String(i).padStart(2, '0')}`);

      // Detect: clarifications modal (success), retry CTA (failure),
      // or build CTA (refine already done).
      const modalOpen = await page
        .locator('#clarifications-modal')
        .isVisible()
        .catch(() => false);
      const retryCta = await page
        .locator('#propose-retry-button')
        .isVisible()
        .catch(() => false);
      const obsRetry = await page
        .locator('.obs-retry')
        .isVisible()
        .catch(() => false);
      if (modalOpen || retryCta || obsRetry) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(true);
    await shot(page, '07-result-landed');

    // Retry path: if we hit the failure UI, click Try Again and try
    // one more time before giving up.
    if (await page.locator('#propose-retry-button').isVisible()) {
      await shot(page, '08-retry-cta-visible');
      await page.locator('#propose-retry-button').click();
      // wait for the next run to land (same deadline)
      const deadline2 = Date.now() + 5 * 60_000;
      let j = 0;
      while (Date.now() < deadline2) {
        j += 1;
        await page.waitForTimeout(10_000);
        await shot(page, `09-retry-progress-${String(j).padStart(2, '0')}`);
        const modalOpen = await page
          .locator('#clarifications-modal')
          .isVisible()
          .catch(() => false);
        const obsRetry = await page
          .locator('.obs-retry')
          .isVisible()
          .catch(() => false);
        if (modalOpen) break;
        if (obsRetry) {
          await shot(page, '10-retry-also-failed');
          test.fail(true, 'Both attempts produced unparseable Quiet Loom output.');
          return;
        }
      }
    }

    // We have clarifications. Screenshot the modal, confirm palette
    // swatches render, then pick warm-amber.
    const cm = page.locator('#clarifications-modal');
    await expect(cm).toBeVisible();
    await shot(page, '11-clarifications-modal');

    // Branding choice — match by id or name; choose Warm Amber.
    const warmAmber = cm
      .locator('input[type="radio"][value*="arm-amber"], input[type="radio"][value="Warm Amber"]')
      .first();
    await warmAmber.waitFor({ timeout: 5_000 });
    await warmAmber.check();
    await shot(page, '12-warm-amber-picked');

    // Submit the clarifications.
    await cm.locator('button[type="submit"], .cm-submit').first().click();

    // Refine kicks in — wait for either the build CTA or another modal.
    const refineDeadline = Date.now() + 5 * 60_000;
    let k = 0;
    let readyToBuild = false;
    while (Date.now() < refineDeadline) {
      k += 1;
      await page.waitForTimeout(10_000);
      await shot(page, `13-refine-progress-${String(k).padStart(2, '0')}`);
      const buildBtn = await page
        .locator('#build-cta-button')
        .isVisible()
        .catch(() => false);
      const modalOpen = await page
        .locator('#clarifications-modal')
        .isVisible()
        .catch(() => false);
      if (buildBtn) {
        readyToBuild = true;
        break;
      }
      if (modalOpen) break;
    }
    if (!readyToBuild) {
      // Another clarifications round — fall through to submit empty
      // (the form requires at least the first radio), then look for build.
      const secondCm = page.locator('#clarifications-modal');
      if (await secondCm.isVisible()) {
        // pick the first radio in any field that has one
        const firstRadio = secondCm.locator('input[type="radio"]').first();
        if ((await firstRadio.count()) > 0) await firstRadio.check();
        await secondCm.locator('button[type="submit"], .cm-submit').first().click();
        // wait again
        const d3 = Date.now() + 4 * 60_000;
        while (Date.now() < d3) {
          await page.waitForTimeout(8_000);
          if (await page.locator('#build-cta-button').isVisible()) {
            readyToBuild = true;
            break;
          }
        }
      }
    }
    expect(readyToBuild).toBe(true);
    await shot(page, '14-build-cta');

    // Build!
    await page.locator('#build-cta-button').click();
    const buildDeadline = Date.now() + 2 * 60_000;
    let appRendered = false;
    while (Date.now() < buildDeadline) {
      await page.waitForTimeout(3_000);
      if (await page.locator('.observatory-app').isVisible()) {
        appRendered = true;
        break;
      }
    }
    expect(appRendered).toBe(true);
    await shot(page, '15-app-rendered');

    // Click +New record on the first list tab.
    const addBtn = page.locator('#app-add-button, .app-add-button').first();
    if ((await addBtn.count()) > 0) {
      await addBtn.click();
      await page.waitForTimeout(500);
      await shot(page, '16-record-form-open');
    }
  });
});
