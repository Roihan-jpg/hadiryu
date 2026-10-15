import { defineConfig, devices } from '@playwright/test';

// UI regression only: every API call is intercepted, so this runner cannot reset
// or modify the user's local enrollment/database state.
export default defineConfig({
  testDir: '.',
  testMatch: 'face-ui.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://127.0.0.1:4201', trace: 'off', video: 'off', screenshot: 'off',
    launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']} },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev --workspace @absensi/web -- --port 4201',
    url: 'http://127.0.0.1:4201',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
