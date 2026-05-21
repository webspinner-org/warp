#!/usr/bin/env node
/**
 * editor-probe.mjs — drive the Block-5 direct-edit affordances on
 * WebbaseRuntime end-to-end.
 *
 * This bypasses the broken @playwright/test runner (loom pins
 * @playwright/test@1.59.1 alongside playwright@^1.60.0 — singleton
 * mismatch makes test.describe() throw). The probe uses the plain
 * `playwright` API; same browser, same DOM, fewer moving parts.
 *
 *   pnpm exec node e2e/editor-probe.mjs
 *
 * Reads WARP_E2E_BASE_URL (default http://127.0.0.1:3000) and the
 * superuser creds from ~/.warp/bootstrap.
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env['WARP_E2E_BASE_URL'] ?? 'http://127.0.0.1:3000';
const PB_EMAIL = (
  process.env['WARP_PB_EMAIL'] ?? readFileSync(join(homedir(), '.warp/bootstrap/pb-email'), 'utf8')
).trim();
const PB_PASS = (
  process.env['WARP_PB_PASSWORD'] ??
  readFileSync(join(homedir(), '.warp/bootstrap/pb-password'), 'utf8')
).trim();

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="wizard_id"]').fill(PB_EMAIL);
  await page.locator('input[name="passphrase"]').fill(PB_PASS);
  await page.locator('button[type="submit"]').click();
  try {
    await page.waitForURL(/\/admin(?:\/|$)/, { timeout: 8000 });
  } catch {
    const url = page.url();
    const errText = await page.locator('body').textContent();
    throw new Error(
      `signIn did not reach /admin — currently at ${url}; body excerpt: ${errText?.slice(0, 200)}`,
    );
  }
}

async function readDrafts(page) {
  return page.evaluate(() => globalThis.__editorProbeChanges ?? []);
}

async function main() {
  console.log(`→ editor-probe vs ${BASE}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Forward browser console errors so we can see Svelte warnings/errors.
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      console.log(`  [browser:${m.type()}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => console.log(`  [browser:pageerror] ${e.message}`));

  try {
    await signIn(page);
    await page.goto(`${BASE}/admin/editor-probe`);
    await page.locator('[data-testid="probe-bar"]').waitFor({ state: 'visible' });

    const initialCount = await page.locator('[data-testid="change-count"]').textContent();
    check('initial change-count is 0', initialCount?.trim() === '0', `got ${initialCount}`);

    const labels = page.locator('.field-label-input');
    const labelCount = await labels.count();
    check('three seed fields render', labelCount === 3, `${labelCount} fields`);
    check(
      'seed labels are Title/Body/When',
      (await labels.nth(0).inputValue()) === 'Title' &&
        (await labels.nth(1).inputValue()) === 'Body' &&
        (await labels.nth(2).inputValue()) === 'When',
    );

    // 1. Rename Title → Headline
    await labels.nth(0).fill('Headline');
    // Force-fire blur via DOM event because Playwright's locator.blur()
    // is sometimes a no-op when the input was just focused via fill().
    await labels.nth(0).evaluate((el) => {
      el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-testid="change-count"]')?.textContent === '1',
        { timeout: 4000 },
      );
    } catch {
      const cnt = await page.locator('[data-testid="change-count"]').textContent();
      const v0 = await labels.nth(0).inputValue();
      throw new Error(`rename did not emit change — count=${cnt}, label[0] value=${v0}`);
    }
    let drafts = await readDrafts(page);
    check('rename emitted 1 change', drafts.length === 1);
    const f0 = drafts[0]?.screens?.[0]?.layout?.sections?.[0]?.fields ?? [];
    check('rename: field[0].label is Headline', f0[0]?.label === 'Headline', `got ${f0[0]?.label}`);
    check('rename: field[0].id preserved', f0[0]?.id === 'title');

    // 2. Delete Body field (index 1 after rename above)
    const fieldsForDelete = page.locator('label.field--editable');
    await fieldsForDelete.nth(1).locator('button.field-del').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="change-count"]')?.textContent === '2',
      { timeout: 2000 },
    );
    const afterDeleteCount = await labels.count();
    check('after delete, 2 fields remain', afterDeleteCount === 2);
    drafts = await readDrafts(page);
    const f1 = drafts[1]?.screens?.[0]?.layout?.sections?.[0]?.fields ?? [];
    check('delete: 2 fields in emitted draft', f1.length === 2, `${f1.length} fields`);
    check(
      'delete: remaining ids are title, when',
      f1.map((f) => f.id).join(',') === 'title,when',
      f1.map((f) => f.id).join(','),
    );

    // 3. Add a new field
    await page.locator('button.field-add').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="change-count"]')?.textContent === '3',
      { timeout: 2000 },
    );
    const afterAddCount = await labels.count();
    check('after add, 3 fields again', afterAddCount === 3);
    check('new field labelled "New field"', (await labels.nth(2).inputValue()) === 'New field');
    drafts = await readDrafts(page);
    const f2 = drafts[2]?.screens?.[0]?.layout?.sections?.[0]?.fields ?? [];
    check('add: 3 fields in emitted draft', f2.length === 3);
    check('add: new field kind is text', f2[2]?.kind === 'text');
    check('add: new field id starts with field_', /^field_/.test(f2[2]?.id ?? ''));

    // 4. Rename the new field
    await labels.nth(2).fill('Tags');
    await labels.nth(2).blur();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="change-count"]')?.textContent === '4',
      { timeout: 2000 },
    );
    drafts = await readDrafts(page);
    const f3 = drafts[3]?.screens?.[0]?.layout?.sections?.[0]?.fields ?? [];
    check('renamed new field to Tags', f3[2]?.label === 'Tags');

    // 5. No-op blur emits no change
    await labels.nth(0).focus();
    await labels.nth(0).blur();
    await page.waitForTimeout(150);
    const finalCount = await page.locator('[data-testid="change-count"]').textContent();
    check('no-op blur does not emit', finalCount?.trim() === '4', `got ${finalCount}`);

    // 6. Save button is suppressed in edit mode
    const hintVisible = await page.locator('.edit-mode-hint').isVisible();
    const saveCount = await page.locator('button.btn-primary', { hasText: 'Save' }).count();
    check('edit-mode hint visible', hintVisible);
    check('Save button suppressed in edit mode', saveCount === 0);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\n✓ all checks passed' : `\n✗ ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exit(2);
});
