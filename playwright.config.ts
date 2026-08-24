import { defineConfig, devices } from '@playwright/test';

const useExternalServers = process.env['GOALPILOT_E2E_EXTERNAL_SERVERS'] === 'true';

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
  ...(useExternalServers
    ? {}
    : {
        webServer: [
          {
            command: 'node --conditions=development --import tsx apps/api/src/server.ts',
            env: {
              ENVIRONMENT: 'test',
              NODE_ENV: 'test',
              TEST_RATE_LIMIT_MAX: '2000',
              DEMO_STORY_ENABLED: 'true',
              PURCHASE_TIMING_LAB_ENABLED: 'true',
              API_PORT: '3100',
              API_ORIGIN: 'http://localhost:3100',
              WEB_ORIGIN: 'http://localhost:5273',
            },
            url: 'http://localhost:3100/health/ready',
            reuseExistingServer: false,
            timeout: 60_000,
          },
          {
            command:
              'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5273',
            env: {
              GOALPILOT_WEB_PORT: '5273',
              GOALPILOT_API_PROXY_ORIGIN: 'http://localhost:3100',
            },
            url: 'http://localhost:5273',
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ],
      }),
});
