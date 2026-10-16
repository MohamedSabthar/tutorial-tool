import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // seed/ holds workspace files (tutorial scripts named *.spec.ts), not tests.
    exclude: ['**/node_modules/**', 'seed/**'],
    testTimeout: 20_000,
  },
});
