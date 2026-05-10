import { expect, test } from '@playwright/test';
import { signIn } from './auth.js';

test.describe("Wizard's Journal", () => {
  test('record an entry → it appears in recent → recall finds it', async ({ page }) => {
    await signIn(page);
    await page.locator('aside.nav a', { hasText: "Wizard's Journal" }).click();
    await expect(page).toHaveURL(/\/admin\/journal$/);
    await expect(page.locator('h1')).toHaveText("Wizard's Journal");

    const unique = `e2e-journal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const title = `Test entry ${unique}`;
    const body = `Playwright wrote this on a smoke run. Tag: ${unique}. The Cell is the Wizard's home — the eye should land somewhere.`;

    // Record an entry. The radio is hidden behind a styled chip — click
    // the visible chip span instead of the underlying input.
    await page.locator('section.entry .kind-choice').filter({ hasText: 'learning' }).click();
    await page.locator('section.entry input[type="text"]').first().fill(title);
    await page.locator('section.entry textarea').fill(body);
    await page.locator('section.entry input[type="text"]').nth(1).fill(unique);
    await page.locator('section.entry button[type="submit"]').click();

    // Confirmation banner.
    await expect(page.locator('section.entry .ok')).toContainText(title);

    // Entry appears in the recent list.
    const entryRow = page.locator('li.entry-row', { hasText: title });
    await expect(entryRow).toBeVisible();
    await expect(entryRow.locator('.kind')).toHaveText('learning');
    await expect(entryRow.locator('.tag-chip')).toContainText(unique);

    // Filter to learning entries only — the new entry stays visible.
    await page.locator('.recent-head .filters button', { hasText: 'Learnings' }).click();
    await expect(entryRow).toBeVisible();
  });

  test('bootstrap context generates when entries exist', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/journal');

    // Generate session context.
    await page.locator('.bootstrap-controls .generate').click();

    // The viewer renders within a reasonable timeout.
    const viewer = page.locator('.bootstrap-viewer pre code');
    await expect(viewer).toBeVisible({ timeout: 15_000 });
    const text = await viewer.innerText();
    expect(text.length).toBeGreaterThan(50);
    // Should contain the markdown header the journalBootstrap composes.
    expect(text).toContain('# Resume context');
  });
});
