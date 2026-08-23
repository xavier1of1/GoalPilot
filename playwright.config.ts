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
    baseURL: 'http://localhost:5173',
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
      command: 'cross-env ENVIRONMENT=test NODE_ENV=test pnpm --filter @goalpilot/api dev',
      url: 'http://localhost:3000/health/ready',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @goalpilot/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
