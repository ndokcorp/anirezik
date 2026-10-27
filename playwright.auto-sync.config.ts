import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'auto-sync-live.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 100000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4322/',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 4322',
    url: 'http://127.0.0.1:4322/',
    reuseExistingServer: false,
  },
});
