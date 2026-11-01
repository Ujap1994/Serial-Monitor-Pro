// Long-run test: `npm run soak` (see docs/LONG_RUN_TEST.md).
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
  test: {
    include: ['tests/soak/**/*.soak.ts'],
    environment: 'node',
    // The run itself decides how long it takes.
    testTimeout: 0,
    hookTimeout: 0,
    reporters: ['default'],
  },
});
