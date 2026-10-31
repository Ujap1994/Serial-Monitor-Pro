import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '@shared/core/settings';
import { connect, expect, launch, test } from './fixtures';

test('inserts the selected endian CRC at signed positions and sends exactly the preview', async ({
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
    ['little', '-1', '01 03 00 00 C5 CD 00 0A'],
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

test('excludes existing header/footer, rejects mismatches without writing, and permits disabling CRC', async ({
  page,
}) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-input').fill('AA 55 31 32 33 34 35 36 37 38 39 0D 0A');
  await page.getByTestId('crc-header').fill('AA 55');
  await page.getByTestId('crc-footer').fill('0D 0A');
  await page.getByTestId('crc-include-header').uncheck();
  await page.getByTestId('crc-include-footer').uncheck();
  await page.getByTestId('crc-position').fill('-1');
  await page.getByTestId('crc-position').press('Enter');
  await page.getByTestId('crc-auto').check();
  await expect(page.getByTestId('crc-packet')).toHaveText(
    'AA 55 31 32 33 34 35 36 37 38 39 37 4B 0D 0A',
  );
  await page.getByTestId('tab-monitor').click();
  await page.getByTestId('send-input').fill('AA 55 31 32 33 34 35 36 37 38 39 0D 0A');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('monitor-output').locator('.ln-tx')).toContainText(
    'AA 55 31 32 33 34 35 36 37 38 39 37 4B 0D 0A 0A',
  );
  await page.getByTestId('send-input').fill('01 02');
  await expect(page.getByTestId('send-preview')).toContainText('Header/footer do not match');
  await expect(page.getByTestId('send-button')).toBeDisabled();
  // Enter must also validate at the send boundary, not only via the button state.
  await page.getByTestId('send-input').press('Enter');
  await expect(page.getByTestId('message-dialog')).toContainText('Header/footer do not match');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('monitor-output').locator('.ln-tx')).toHaveCount(1);
  await page.getByTestId('monitor-crc-auto').uncheck();
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('monitor-output').locator('.ln-tx').last()).toContainText(
    '01 02 0A',
  );
});

test('persists CRC configuration across a full restart and keeps invalid positions visible', async ({
  app,
  page,
  profile,
}) => {
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-endian').selectOption('big');
  await page.getByTestId('crc-algo').selectOption('CRC-32');
  await page.getByTestId('crc-position').fill('999');
  await page.getByTestId('crc-position').press('Enter');
  await page.getByTestId('crc-auto').check();
  await page.getByTestId('crc-header').fill('AA');
  await page.getByTestId('crc-include-header').uncheck();
  await expect
    .poll(
      () =>
        (JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')) as Settings).transmitCrc,
    )
    .toMatchObject({
      enabled: true,
      algorithm: 'CRC-32',
      bigEndian: true,
      position: 999,
      header: 'AA',
      includeHeader: false,
    });
  await app.close();
  const restarted = await launch(profile);
  try {
    await restarted.page.getByTestId('tab-crc').click();
    await expect(restarted.page.getByTestId('crc-position')).toHaveValue('999');
    await expect(restarted.page.getByTestId('crc-auto')).toBeChecked();
    await expect(restarted.page.getByTestId('crc-endian')).toHaveValue('big');
    await expect(restarted.page.getByTestId('crc-algo')).toHaveValue('CRC-32');
    await expect(restarted.page.getByTestId('crc-include-header')).not.toBeChecked();
    await restarted.page.getByTestId('crc-input').fill('AA 01');
    await expect(restarted.page.getByTestId('crc-error')).toContainText('CRC position 999');
  } finally {
    await restarted.app.close();
  }
});
