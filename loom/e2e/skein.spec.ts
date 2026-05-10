import { expect, test } from '@playwright/test';
import { signIn } from './auth.js';

test.describe('Skein (Spinners listing)', () => {
  test('lists registered Spinners with search and filter', async ({ page }) => {
    await signIn(page);

    await page.locator('aside.nav a', { hasText: 'Installed' }).click();
    await expect(page).toHaveURL(/\/admin\/spinners$/);
    await expect(page.locator('h1')).toHaveText('Skein');

    // Lede should mention a Spinner count.
    await expect(page.locator('.lede')).toContainText(/\d+ Spinner/);

    // The three registered Spinners should appear in the list.
    const rows = page.locator('ul.list li');
    await expect(rows).toContainText(['Bootstrap Spinner']);
    await expect(rows).toContainText(['Pablo']);
    await expect(rows).toContainText(["Wizard's Journal"]);

    // Search filters in real time.
    await page.locator('input[type="search"]').fill('pablo');
    const visibleRows = page.locator('ul.list li').filter({ hasText: 'Pablo' });
    await expect(visibleRows.first()).toBeVisible();
    await expect(page.locator('ul.list li').filter({ hasText: 'Bootstrap' })).toHaveCount(0);

    // Clear search.
    await page.locator('input[type="search"]').fill('');
    await expect(rows).toContainText(['Bootstrap Spinner']);
  });
});
