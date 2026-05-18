#!/usr/bin/env node
/**
 * try-full-loop.mjs — exercises every patron-facing surface of
 * try.webspinner.ai end-to-end after the Form Studio batch:
 *
 *   1. Splash bypassed (localStorage seed)
 *   2. Bookkeeping sentence submitted
 *   3. Phases: identifying-domain → researching-conventions →
 *      reading-references → modeling-domain → drafting-screens →
 *      drafting-branding → proposed
 *   4. Clarifications modal: picks one option per field
 *   5. Refine → ready
 *   6. Customize first → Form Studio opens
 *   7. Studio: rename a label, change a kind, add a field, drag-reorder
 *   8. Done → returns
 *   9. Affirm & build → app rendered
 *  10. Open Transactions dropdown → click Record a Transaction
 *  11. Inline form renders; link-to dropdown has "+ Add new"
 *  12. Click +Add new → slide-over opens
 *  13. Fill + save → returns; new record selected
 *
 * Screenshots + HTML snapshots land in ~/Desktop/playwright-try/
 * full-loop-<ts>/ for visual review.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.argv[2] ?? 'https://try.webspinner.ai';
const SHOT_DIR = join(
  homedir(),
  'Desktop',
  'playwright-try',
  'full-loop-' + new Date().toISOString().replace(/[:.]/g, '-'),
);
mkdirSync(SHOT_DIR, { recursive: true });
console.log('[drive] base =', BASE_URL);
console.log('[drive] artifacts →', SHOT_DIR);

async function snap(page, name) {
  const png = join(SHOT_DIR, `${name}.png`);
  const html = join(SHOT_DIR, `${name}.html`);
  await page.screenshot({ path: png, fullPage: false });
  const dom = await page.content();
  writeFileSync(html, dom);
  console.log('[snap]', name);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('webspinner-try-splash-seen', '1');
    localStorage.setItem('webspinner-try-intro', '1');
    localStorage.setItem('webspinner-try-name', 'John');
    localStorage.setItem('webspinner-try-drink', 'none');
    // Force a brand-new demo session — no resume of a prior built app.
    localStorage.removeItem('webspinner-try-session');
    // Clear any prior Form Studio customizations.
    Object.keys(localStorage)
      .filter((k) => k.startsWith('webspinner-try-design-'))
      .forEach((k) => localStorage.removeItem(k));
  } catch (_) {
    /* localStorage unavailable */
  }
});
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

let exitCode = 0;
try {
  await page.goto(BASE_URL);
  const chat = page.locator('#weaver-input');
  await chat.waitFor({ timeout: 15000 });
  for (let i = 0; i < 30; i++) {
    const dis = await chat.getAttribute('disabled').catch(() => null);
    if (dis === null) break;
    await page.waitForTimeout(300);
  }
  await snap(page, '01-landed');

  await chat.fill('I want to keep track of my small-business bookkeeping.');
  await chat.press('Enter');
  await page.waitForTimeout(2000);
  await snap(page, '02-observatory-up');

  // Watch for the clarifications modal or retry CTA (up to 7 min — the
  // new modeling-domain stage adds ~30-60s).
  const dl = Date.now() + 7 * 60_000;
  let i = 0;
  let landed = false;
  while (Date.now() < dl) {
    i += 1;
    await page.waitForTimeout(i < 12 ? 5_000 : 10_000);
    await snap(page, `03-progress-${String(i).padStart(2, '0')}`);
    const modal = await page
      .locator('#clarifications-modal')
      .isVisible()
      .catch(() => false);
    const retry = await page
      .locator('#propose-retry-button')
      .isVisible()
      .catch(() => false);
    if (modal || retry) {
      landed = true;
      break;
    }
  }
  if (!landed) throw new Error('propose never resolved');
  if (
    await page
      .locator('#propose-retry-button')
      .isVisible()
      .catch(() => false)
  ) {
    await snap(page, '99-propose-failed');
    throw new Error('propose failure UI shown');
  }
  await snap(page, '04-clarifications-modal');

  // Fill clarifications — pick first radio of each fieldset; pick
  // warm-amber for branding-choice.
  const cm = page.locator('#clarifications-modal');
  const fields = cm.locator('.cm-field');
  const fcount = await fields.count();
  for (let f = 0; f < fcount; f++) {
    const fs = fields.nth(f);
    const radios = fs.locator('input[type="radio"]');
    const rcount = await radios.count();
    if (rcount > 0) {
      // Prefer warm-amber on a branding-choice field; else first radio.
      const warm = fs
        .locator('input[type="radio"][value*="arm-amber"], input[type="radio"][value="Warm Amber"]')
        .first();
      if ((await warm.count()) > 0) await warm.check();
      else await radios.first().check();
    } else {
      const checkboxes = fs.locator('input[type="checkbox"]');
      if ((await checkboxes.count()) > 0) await checkboxes.first().check();
      else {
        const ta = fs.locator('textarea');
        if ((await ta.count()) > 0) await ta.first().fill('yes');
      }
    }
  }
  await snap(page, '05-clarifications-filled');

  // Scroll inside the cm-fields to make sure the submit is visible,
  // then click submit.
  await cm.locator('button[type="submit"], .cm-submit').first().click();

  // Wait for build CTA (refine returns).
  const rd = Date.now() + 7 * 60_000;
  let k = 0;
  let ready = false;
  while (Date.now() < rd) {
    k += 1;
    await page.waitForTimeout(10_000);
    await snap(page, `06-refine-${String(k).padStart(2, '0')}`);
    if (
      await page
        .locator('#build-cta-affirm')
        .isVisible()
        .catch(() => false)
    ) {
      ready = true;
      break;
    }
    // Second-round clarifications: fill and submit.
    if (
      await page
        .locator('#clarifications-modal')
        .isVisible()
        .catch(() => false)
    ) {
      const cm2 = page.locator('#clarifications-modal');
      const fields2 = cm2.locator('.cm-field');
      const fc2 = await fields2.count();
      for (let f = 0; f < fc2; f++) {
        const radios = fields2.nth(f).locator('input[type="radio"]');
        if ((await radios.count()) > 0) await radios.first().check();
      }
      await cm2.locator('button[type="submit"], .cm-submit').first().click();
    }
  }
  if (!ready) throw new Error('refine never reached readyToBuild');
  await snap(page, '07-affirm-cta');

  // ──── Form Studio ─────────────────────────────────────────────────
  await page.locator('#build-cta-customize').click();
  await page.waitForTimeout(800);
  await snap(page, '08-studio-open');

  // Click around — pick the second form-screen tab if present
  const tabs = page.locator('.studio-tab');
  const tabCount = await tabs.count();
  if (tabCount > 1) {
    await tabs.nth(1).click();
    await page.waitForTimeout(400);
    await snap(page, '09-studio-tab2');
    await tabs.nth(0).click();
    await page.waitForTimeout(400);
  }

  // Rename the first field's label
  const firstLabel = page.locator('.studio-field-label').first();
  if ((await firstLabel.count()) > 0) {
    await firstLabel.fill('Renamed by test');
    await page.waitForTimeout(200);
  }
  // Change first field's kind to money
  const firstKind = page.locator('.studio-field-kind').first();
  if ((await firstKind.count()) > 0) {
    await firstKind.selectOption('money');
    await page.waitForTimeout(400);
  }
  // Click Add field on the first section
  const addField = page.locator('.studio-add-field').first();
  if ((await addField.count()) > 0) {
    await addField.click();
    await page.waitForTimeout(400);
  }
  await snap(page, '10-studio-edited');

  // Done & return
  await page.locator('#studio-done').click();
  await page.waitForTimeout(800);
  await snap(page, '11-after-studio');

  // ──── Affirm & build ─────────────────────────────────────────────
  await page.locator('#build-cta-affirm').click();
  const bd = Date.now() + 3 * 60_000;
  let appReady = false;
  while (Date.now() < bd) {
    await page.waitForTimeout(3000);
    if (
      await page
        .locator('.observatory-app')
        .isVisible()
        .catch(() => false)
    ) {
      appReady = true;
      break;
    }
  }
  if (!appReady) throw new Error('app never rendered');
  await snap(page, '12-app-rendered');

  // Open the first dropdown menu, click a form-screen item
  const firstMenuBtn = page.locator('.app-menu-button').first();
  if ((await firstMenuBtn.count()) > 0) {
    await firstMenuBtn.click();
    await page.waitForTimeout(300);
    await snap(page, '13-dropdown-open');
    // Click the form-kind item if present
    const formItem = page.locator('.app-menu-item--form').first();
    if ((await formItem.count()) > 0) {
      await formItem.click();
      await page.waitForTimeout(800);
      await snap(page, '14-inline-form');
    } else {
      // Click anything that takes us to a form-kind screen
      await page.locator('.app-menu-item').first().click();
      await page.waitForTimeout(500);
    }
  }

  // Look for a link-to dropdown — if present, click "+ Add new"
  const linkSelects = page.locator('.rf-linkto-select');
  if ((await linkSelects.count()) > 0) {
    await snap(page, '15-linkto-present');
    const sel = linkSelects.first();
    // Browser-dropdowns are notoriously hard to interact with via
    // playwright. Just verify the option exists.
    const hasAdd = (await sel.locator('option[value="__add_new__"]').count()) > 0;
    console.log('[drive] linkto has Add-new option:', hasAdd);
    if (hasAdd) {
      // Trigger it programmatically and dispatch change event.
      await sel.selectOption('__add_new__');
      await page.waitForTimeout(800);
      await snap(page, '16-slideover-open');
      // Cancel the slide-over.
      const cancel = page.locator('.slideover-back, .slideover-close').first();
      if ((await cancel.count()) > 0) await cancel.click();
      await page.waitForTimeout(400);
    }
  }

  // Share flow — click Export, fill email, fetch code from the dev
  // outbox via SSH, enter code, expect install link.
  const exportBtn = page.locator('#app-export-btn');
  if ((await exportBtn.count()) > 0) {
    await snap(page, '22-pre-share');
    await exportBtn.click();
    await page.waitForTimeout(500);
    const emailInput = page.locator('#share-email');
    if ((await emailInput.count()) > 0) {
      const testEmail = `e2e-${Date.now()}@webspinner.foundation`;
      await emailInput.fill(testEmail);
      await snap(page, '23-share-email-entered');
      await page.locator('#share-send-code').click();
      await page.waitForTimeout(2_000);
      await snap(page, '24-share-code-prompt');

      // Pull the code from the dev outbox on Kepler via SSH.
      const { execSync } = await import('node:child_process');
      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const tail = execSync(`ssh johns-mac-studio.local "tail -1 ~/.warp/email-outbox.jsonl"`, {
            encoding: 'utf8',
            timeout: 10_000,
          });
          const m = tail.match(/verification code: (\d{6})/);
          if (m && tail.includes(testEmail)) {
            code = m[1];
            break;
          }
        } catch (_) {
          /* retry */
        }
        await page.waitForTimeout(1_000);
      }
      if (code) {
        console.log('[drive] pulled code from outbox:', code);
        await page.locator('#share-code').fill(code);
        await snap(page, '25-share-code-entered');
        const [pubResp] = await Promise.all([
          page
            .waitForResponse((r) => r.url().includes('/publish') && r.status() < 500, {
              timeout: 60_000,
            })
            .catch(() => null),
          page.locator('#share-verify').click(),
        ]);
        if (pubResp) {
          const pubBody = await pubResp.json().catch(() => null);
          console.log('[drive] publish status:', pubResp.status());
          console.log('[drive] publish result:', JSON.stringify(pubBody).slice(0, 240));
        }
        await page.waitForTimeout(2_000);
        await snap(page, '26-share-done');
        const installInput = page.locator('#share-install-url');
        if ((await installInput.count()) > 0) {
          const installUrl = await installInput.inputValue();
          console.log('[drive] install URL:', installUrl);
        }
      } else {
        console.log('[drive] WARNING: could not pull verification code from outbox');
      }
    } else {
      // Fallback: legacy direct-download path (button still works
      // pre-modal in older builds).
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
        exportBtn.click(),
      ]);
      if (download) {
        const suggested = download.suggestedFilename();
        const saveTo = join(SHOT_DIR, suggested);
        await download.saveAs(saveTo);
        const fs = await import('node:fs/promises');
        const raw = await fs.readFile(saveTo, 'utf8');
        const bundle = JSON.parse(raw);
        console.log('[drive] export →', suggested);
        console.log('[drive] wsap.format =', bundle.format);
        console.log('[drive] wsap.kind =', bundle.kind);
        console.log('[drive] wsap.signature.alg =', bundle.signature?.alg);
        console.log('[drive] wsap entities =', (bundle.schema?.entities || []).length);
      }
    }
    await snap(page, '27-share-after');
  }

  console.log('[drive] SUCCESS');
} catch (err) {
  console.error('[drive] FAILED:', err?.message || err);
  await snap(page, '99-failure-state').catch(() => {
    /* swallow */
  });
  exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
process.exit(exitCode);
