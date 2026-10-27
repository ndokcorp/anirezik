import { defineConfig, devices } from '@playwright/test';
const base = process.env.BASE_PATH?.replace(/\/$/, '') || '';
export default defineConfig({
  testDir: './tests',
  testMatch: 'animevost-sample.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:4322${base}/`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 4322',
    url: `http://127.0.0.1:4322${base}/`,
    reuseExistingServer: true,
  },
});
