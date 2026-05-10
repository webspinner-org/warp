import { expect, test } from '@playwright/test';
import { signIn } from './auth.js';

test.describe('vault', () => {
  test('splash → click → login → vault: add, verify date, delete', async ({ page }) => {
    // Splash
    await page.goto('/');
    const splash = page.locator('a.splash');
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute('href', '/login');

    // Click → login
    await splash.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('h1')).toHaveText('Warp');

    // Login → admin
    await signIn(page);

    // Navigate to vault via the nav
    await page.locator('aside.nav a', { hasText: 'Vault' }).click();
    await expect(page).toHaveURL(/\/admin\/vault$/);
    await expect(page.locator('h1')).toHaveText('Vault');

    // Add a uniquely-named token so reruns don't collide
    const name = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const description = 'playwright e2e test artifact';
    const value = `secret-value-${name}`;

    await page.locator('section.add input[name="name"]').fill(name);
    await page.locator('section.add input[name="description"]').fill(description);
    await page.locator('section.add input[name="value"]').fill(value);
    await page.locator('section.add button[type="submit"]').click();

    // Confirmation: form ok message + row in the table
    await expect(page.locator('section.add .ok')).toContainText(name);
    const row = page.locator('section.list tbody tr', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.locator('td:nth-child(2)')).toHaveText(description);

    // Created/updated cells must NOT show "Invalid Date"
    const created = await row.locator('td:nth-child(3)').innerText();
    const updated = await row.locator('td:nth-child(4)').innerText();
    expect(created).not.toBe('Invalid Date');
    expect(updated).not.toBe('Invalid Date');
    // And both should parse as valid dates
    expect(Number.isFinite(new Date(created).getTime())).toBe(true);
    expect(Number.isFinite(new Date(updated).getTime())).toBe(true);

    // Delete it (handle the confirm() dialog)
    page.once('dialog', (dialog) => dialog.accept());
    await row.locator('button.danger').click();
    await expect(page.locator('section.list .ok')).toContainText(name);
    await expect(row).toHaveCount(0);
  });
});
