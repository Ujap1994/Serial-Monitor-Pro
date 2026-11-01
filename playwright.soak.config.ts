// Long-run test of the user interface: `npm run soak:gui` (see docs/LONG_RUN_TEST.md).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/soak',
  testMatch: '*.soak.spec.ts',
  timeout: 0,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off', screenshot: 'only-on-failure' },
});
