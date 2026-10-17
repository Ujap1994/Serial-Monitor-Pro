import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
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
      // Just below the values without socat (Windows), where the virtual-port
      // tests of serial.ts are skipped – a drop below means tests went missing.
      thresholds: { statements: 86, branches: 77, functions: 81, lines: 88 },
    },
  },
});
