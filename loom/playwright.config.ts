import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env['WARP_E2E_BASE_URL'] ?? 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // sequential — tests share a single PB superuser session
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1, // single worker — vault tests mutate shared state
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
