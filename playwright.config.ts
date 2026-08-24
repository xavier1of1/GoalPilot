import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env['PLAYWRIGHT_CHANNEL'] === undefined
          ? {}
          : { channel: process.env['PLAYWRIGHT_CHANNEL'] }),
      },
    },
  ],
  webServer: [
    {
      command:
        'cross-env ENVIRONMENT=test NODE_ENV=test API_PORT=3100 API_ORIGIN=http://localhost:3100 WEB_ORIGIN=http://localhost:5273 pnpm --filter @goalpilot/api dev',
      url: 'http://localhost:3100/health/ready',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command:
        'cross-env GOALPILOT_WEB_PORT=5273 GOALPILOT_API_PROXY_ORIGIN=http://localhost:3100 pnpm --filter @goalpilot/web dev',
      url: 'http://localhost:5273',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
