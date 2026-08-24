import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'tests/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'apps/web/src/**/*.{ts,tsx}',
        'packages/contracts/src/**/*.ts',
        'packages/domain/src/**/*.ts',
        'packages/data-access/src/**/*.ts',
        'packages/provider-simulators/src/**/*.ts',
        'apps/api/src/**/*.ts',
        'scripts/*.ts',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        'apps/api/src/server.ts',
        'packages/data-access/src/schema.ts',
      ],
      thresholds: {
        'apps/api/src/**': { lines: 85, functions: 90, statements: 85 },
        'packages/data-access/src/**': { lines: 85, functions: 90, statements: 85 },
        'packages/domain/src/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
