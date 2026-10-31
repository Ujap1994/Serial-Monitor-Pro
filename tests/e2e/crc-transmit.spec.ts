// CRC when sending, as in the former Python version: byte order, a position
// counted like Python slicing (0 = append, 1 = 2nd byte, -1 = before the last
// byte), header/footer added automatically, header/footer in the CRC on demand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '@shared/core/settings';
import { connect, expect, launch, test } from './fixtures';

test('inserts the CRC in the selected byte order at signed positions and sends exactly the preview', async ({
  page,
}) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('display-format').selectOption('HEX');
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-input').fill('01 03 00 00 00 0A');
  await page.getByTestId('crc-auto').check();
  const cases = [
    ['little', '0', '01 03 00 00 00 0A C5 CD'],
    ['big', '1', '01 CD C5 03 00 00 00 0A'],
    ['little', '-1', '01 03 00 00 00 C5 CD 0A'],
  ];
  for (const [endian, position, expected] of cases) {
    await page.getByTestId('tab-crc').click();
    await page.getByTestId('crc-endian').selectOption(endian!);
    await page.getByTestId('crc-position').fill(position!);
    await page.getByTestId('crc-position').press('Enter');
    await expect(page.getByTestId('crc-packet')).toHaveText(expected!);
    await page.getByTestId('tab-monitor').click();
    await page.getByTestId('send-input').fill('01 03 00 00 00 0A');
    await expect(page.getByTestId('send-preview')).toContainText(`${expected} 0A`);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('monitor-output').locator('.ln-tx').last()).toContainText(
      `${expected} 0A`,
    );
  }
  await expect(page.getByTestId('counters')).toContainText('RX 27 B');
  await expect(page.getByTestId('counters')).toContainText('TX 27 B');
});

test('adds header and footer like the Python Monitor and includes them in the CRC on demand', async ({
  page,
}) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('display-format').selectOption('HEX');
  await page.getByTestId('send-format').selectOption('HEX');
  await page.getByTestId('send-newline').selectOption('None');
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-endian').selectOption('little');
  await page.getByTestId('tab-monitor').click();
  await page.getByTestId('monitor-use-header').check();
  await page.getByTestId('monitor-header').fill('AA 55');
  await page.getByTestId('monitor-use-footer').check();
  await page.getByTestId('monitor-footer').fill('0D 0A');
  await page.getByTestId('monitor-crc-auto').check();
  await page.getByTestId('send-input').fill('31 32 33 34 35 36 37 38 39');
  // CRC over the data only (Python default): CRC-16/MODBUS 0x4B37.
  await expect(page.getByTestId('send-preview')).toContainText(
    'AA 55 31 32 33 34 35 36 37 38 39 37 4B 0D 0A',
  );
  await page.getByTestId('send-button').click();
  const tx = page.getByTestId('monitor-output').locator('.ln-tx');
  await expect(tx.last()).toContainText('AA 55 31 32 33 34 35 36 37 38 39 37 4B 0D 0A');

  // Header in the CRC: CRC-16/MODBUS over AA 55 31 … 39 = 0xD40B.
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-include-header').check();
  await expect(page.getByTestId('crc-framing')).toContainText('AA 55 (on)');
  await page.getByTestId('tab-monitor').click();
  // The input is cleared after sending (default setting) – type it again.
  await page.getByTestId('send-input').fill('31 32 33 34 35 36 37 38 39');
  await page.getByTestId('send-button').click();
  await expect(tx.last()).toContainText('AA 55 31 32 33 34 35 36 37 38 39 0B D4 0D 0A');

  // An impossible position blocks sending instead of moving the CRC.
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-position').fill('99');
  await page.getByTestId('crc-position').press('Enter');
  await page.getByTestId('tab-monitor').click();
  await page.getByTestId('send-input').fill('31 32');
  await expect(page.getByTestId('send-preview')).toContainText('CRC position 99');
  await expect(page.getByTestId('send-button')).toBeDisabled();
  await page.getByTestId('send-input').press('Enter');
  await expect(page.getByTestId('message-dialog')).toContainText('CRC position 99');
  await page.keyboard.press('Escape');
  await expect(tx).toHaveCount(2);

  // Without CRC, header and footer are still added.
  await page.getByTestId('monitor-crc-auto').uncheck();
  await page.getByTestId('send-input').fill('01 02');
  await page.getByTestId('send-button').click();
  await expect(tx.last()).toContainText('AA 55 01 02 0D 0A');
});

test('persists the transmit settings across a restart and keeps invalid positions visible', async ({
  app,
  page,
  profile,
}) => {
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-endian').selectOption('little');
  await page.getByTestId('crc-tx-algo').selectOption('CRC-32');
  await page.getByTestId('crc-position').fill('999');
  await page.getByTestId('crc-position').press('Enter');
  await page.getByTestId('crc-auto').check();
  await page.getByTestId('crc-include-footer').check();
  await page.getByTestId('tab-monitor').click();
  await page.getByTestId('monitor-use-header').check();
  await page.getByTestId('monitor-header').fill('AA');
  await page.getByTestId('periodic-ms').fill('250');
  await page.getByTestId('periodic-ms').press('Enter');
  await expect
    .poll(() => JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')) as Settings)
    .toMatchObject({
      periodicMs: 250,
      transmitCrc: {
        enabled: true,
        algorithm: 'CRC-32',
        bigEndian: false,
        position: 999,
        useHeader: true,
        header: 'AA',
        includeHeader: false,
        includeFooter: true,
      },
    });
  await app.close();
  const restarted = await launch(profile);
  try {
    const p = restarted.page;
    await expect(p.getByTestId('monitor-crc-auto')).toBeChecked();
    await expect(p.getByTestId('monitor-header')).toHaveValue('AA');
    await expect(p.getByTestId('periodic-ms')).toHaveValue('250');
    await p.getByTestId('tab-crc').click();
    await expect(p.getByTestId('crc-position')).toHaveValue('999');
    await expect(p.getByTestId('crc-endian')).toHaveValue('little');
    await expect(p.getByTestId('crc-tx-algo')).toHaveValue('CRC-32');
    await expect(p.getByTestId('crc-include-footer')).toBeChecked();
    await p.getByTestId('crc-input').fill('AA 01');
    await expect(p.getByTestId('crc-error')).toContainText('CRC position 999');
  } finally {
    await restarted.app.close();
  }
});

test.describe('presets with "Append CRC"', () => {
  test.use({
    seed: {
      settings: { transmitCrc: { bigEndian: false, position: 0 } },
      commands: [
        {
          name: 'Read',
          data: '01 03 00 00 00 0A',
          fmt: 'HEX',
          newline: 'None',
          addCrc: true,
          description: 'Reads ten holding registers',
        },
      ],
    },
  });

  test('appends the CRC without the Monitor header', async ({ page }) => {
    await connect(page, 'sim:loopback');
    await page.getByTestId('display-format').selectOption('HEX');
    await page.getByTestId('monitor-use-header').check();
    await page.getByTestId('monitor-header').fill('FF');
    await expect(page.getByTestId('quick-list')).toContainText('HEX +CRC');
    await page.getByTestId('quick-list').getByText('Read').click();
    await expect(page.getByTestId('monitor-output').locator('.ln-tx').last()).toContainText(
      '01 03 00 00 00 0A C5 CD',
    );
    await page.getByTestId('tab-presets').click();
    await expect(page.getByTestId('preset-preview')).toContainText('01 03 00 00 00 0A C5 CD');
    await expect(page.getByTestId('preset-description')).toHaveText('Reads ten holding registers');
  });
});
