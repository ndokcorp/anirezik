import { defineConfig, devices } from '@playwright/test';
const base = process.env.BASE_PATH?.replace(/\/$/, '') || '';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 4,
  globalTimeout: process.env.CI ? 360000 : undefined,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:4322${base}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4322',
    url: `http://127.0.0.1:4322${base}/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'unit', testMatch: /(?:providers|image-policy|maintenance)\.spec\.ts/ },
    { name: 'chromium', testMatch: 'site.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: 'site.spec.ts', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: 'site.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
});
