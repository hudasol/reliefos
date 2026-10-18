import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
