import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/shared/**',
        'src/main/serial.ts',
        'src/main/simulator.ts',
        'src/main/storage.ts',
        'src/renderer/src/lib/monitor.ts',
      ],
      reporter: ['text', 'html'],
      // About two points below the measured values (93/83/93/96 %, the same with
      // and without socat thanks to the scripted driver in serial-port-mock) –
      // a drop below means tests went missing.
      thresholds: { statements: 91, branches: 80, functions: 91, lines: 93 },
    },
  },
});
