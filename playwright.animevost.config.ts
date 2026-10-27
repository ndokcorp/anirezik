import { defineConfig, devices } from '@playwright/test';
const base = process.env.BASE_PATH?.replace(/\/$/, '') || '';
export default defineConfig({
  testDir: './tests',
  testMatch: 'animevost-live.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:4322${base}/`, trace: 'off', video: 'off' },
  webServer: {
    command:
      process.env.ANIMEVOST_LIVE_DEV === '1'
        ? 'npm run dev -- --port 4322'
        : 'npm run preview -- --port 4322',
    url: `http://127.0.0.1:4322${base}/`,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
});
