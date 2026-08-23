import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'packages/domain/src/**/*.ts',
        'packages/data-access/src/**/*.ts',
        'apps/api/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', 'apps/api/src/server.ts', 'packages/data-access/src/schema.ts'],
      thresholds: {
        'apps/api/src/**': { lines: 85, functions: 90, statements: 85 },
        'packages/data-access/src/**': { lines: 85, functions: 90, statements: 85 },
        'packages/domain/src/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
      },
    },
  },
});
