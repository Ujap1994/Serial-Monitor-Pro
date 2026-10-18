// The application with real hardware. Like tests/unit/serial-hardware.test.ts
// it only runs when a port is named explicitly (TX connected to RX), never
// against whatever happens to be plugged in:
//
//   npm run build && SMP_HW_PORT=/dev/ttyUSB0 npx playwright test tests/e2e/hardware.spec.ts

import { expect, test } from './fixtures';

const path = process.env.SMP_HW_PORT ?? '';

test.describe('real hardware loopback', () => {
  test.skip(!path, 'SMP_HW_PORT is not set');

  test.describe('115200 baud 8N1', () => {
    test.use({ seed: { settings: { port: path, baud: 115200 } } });

    test('connects through the UI, sends text and hex and shows the echo', async ({ page }) => {
      await page.getByTestId('connect-button').click();
      await expect(page.getByTestId('connection-state')).toHaveText('connected');
      const rx = page.getByTestId('monitor-output').locator('.ln-rx');

      await page.getByTestId('send-format').selectOption('ASCII');
      await page.getByTestId('send-input').fill('Hello Serial Monitor Pro');
      await page.getByTestId('send-input').press('Enter');
      await expect(rx.last()).toContainText('Hello Serial Monitor Pro');

      await page.getByTestId('send-format').selectOption('HEX');
      await page.getByTestId('send-input').fill('00 7F 80 FF');
      await page.getByTestId('send-input').press('Enter');
      await page.getByTestId('display-format').selectOption('HEX');
      await expect(rx.last()).toContainText('00 7F 80 FF 0A');

      // 24 characters + LF, then 4 bytes + LF – in both directions.
      await expect(page.getByTestId('counters')).toContainText('RX 30 B');
      await expect(page.getByTestId('counters')).toContainText('TX 30 B');
    });
  });

  test.describe('automation', () => {
    test.use({
      seed: {
        settings: { port: path, baud: 115200 },
        automation: [
          { kind: 'send', data: 'PING', fmt: 'ASCII', newline: 'CRLF', value: 0 },
          { kind: 'expect', data: 'PING', fmt: 'ASCII', value: 1000 },
        ],
      },
    });

    test('catches the echo of a real device in an expect step', async ({ page }) => {
      await page.getByTestId('connect-button').click();
      await expect(page.getByTestId('connection-state')).toHaveText('connected');
      await page.getByTestId('tab-automation').click();
      for (let run = 0; run < 5; run++) {
        await page.getByTestId('automation-run').click();
        await expect(page.getByTestId('automation-status')).toHaveText('Sequence finished');
      }
    });
  });

  test.describe('9600 baud 8E1', () => {
    test.use({ seed: { settings: { port: path, baud: 9600, parity: 'Even' } } });

    test('works with parity and a low baud rate', async ({ page }) => {
      await page.getByTestId('connect-button').click();
      await expect(page.getByTestId('connection-state')).toHaveText('connected');
      await page.getByTestId('send-format').selectOption('ASCII');
      await page.getByTestId('send-input').fill('parity check 0123456789');
      await page.getByTestId('send-input').press('Enter');
      await expect(page.getByTestId('monitor-output').locator('.ln-rx').last()).toContainText(
        'parity check 0123456789',
      );
    });
  });
});
