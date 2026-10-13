import { connect, expect, test } from './fixtures';

const COMMANDS = [
  { name: 'Ping', data: 'AT', fmt: 'ASCII', newline: 'CRLF', delayMs: 100, enabled: true },
  { name: 'Info', data: 'ATI', fmt: 'ASCII', newline: 'CRLF', delayMs: 100, enabled: true },
  { name: 'Skipped', data: '01 02', fmt: 'HEX', newline: 'None', delayMs: 100, enabled: false },
];

test.describe('presets and send table', () => {
  test.use({ seed: { commands: COMMANDS } });

  test('creates a command that appears everywhere', async ({ page }) => {
    await page.getByTestId('tab-presets').click();
    await page.getByTestId('preset-new').click();
    await page.getByTestId('command-name').fill('Read registers');
    await page.getByTestId('command-data').fill('01 03 00 00 00 0A C5 CD');
    await expect(page.getByTestId('command-preview')).toContainText(
      '01 03 00 00 00 0A C5 CD 0A   (9 B)',
    );
    await page.getByTestId('command-save').click();
    await expect(page.getByTestId('preset-list')).toContainText('Read registers');
    await page.getByTestId('tab-sendtable').click();
    await expect(page.getByTestId('send-table')).toContainText('Read registers');
    await page.getByTestId('tab-monitor').click();
    await expect(page.getByTestId('quick-list')).toContainText('Read registers');
  });

  test('validates the command editor', async ({ page }) => {
    await page.getByTestId('tab-presets').click();
    await page.getByTestId('preset-new').click();
    await page.getByTestId('command-save').click();
    await expect(page.getByTestId('command-editor')).toContainText('Name is missing');
  });

  test('sends a quick command from the monitor', async ({ page }) => {
    await connect(page, 'sim:sensor', 9600);
    await page.getByTestId('quick-list').getByText('Ping').click();
    const out = page.getByTestId('monitor-output');
    await expect(out.locator('.ln-tx')).toContainText('[Ping] AT');
    await expect(out.locator('.ln-rx', { hasText: /^.*OK$/ }).first()).toBeVisible();
  });

  test('runs the active commands as a sequence', async ({ page }) => {
    await connect(page, 'sim:sensor', 9600);
    await page.getByTestId('tab-sendtable').click();
    await page.getByTestId('sendtable-run').click();
    await expect(page.getByTestId('sendtable-status')).toHaveText('Sequence finished');
    await page.getByTestId('tab-monitor').click();
    const tx = page.getByTestId('monitor-output').locator('.ln-tx');
    await expect(tx).toHaveCount(2);
    await expect(tx.nth(1)).toContainText('[Info] ATI');
  });
});

test('calculates CRCs against the check vector', async ({ page }) => {
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-check-vector').click();
  await expect(page.getByTestId('crc-result')).toContainText('0x4B37');
  await page.getByTestId('crc-compare').click();
  await expect(page.getByTestId('crc-table')).toContainText('0xCBF43926');
  await page.getByTestId('crc-format').selectOption('HEX');
  await page.getByTestId('crc-input').fill('ZZ');
  await expect(page.getByTestId('page-crc')).toContainText('not a valid hexadecimal number');
});

test('decodes Modbus and NMEA examples', async ({ page }) => {
  await page.getByTestId('tab-protocol').click();
  await page.getByTestId('protocol-example').click();
  const out = page.getByTestId('protocol-output');
  await expect(out).toContainText('Read Holding Registers');
  await expect(out).toContainText('CRC ✓');
  await page.getByTestId('protocol-select').selectOption('nmea');
  await page.getByTestId('protocol-example').click();
  await expect(out).toContainText('Checksum ✓');
});

test('decodes live NMEA data from the GPS simulator', async ({ page }) => {
  await connect(page, 'sim:gps');
  await page.getByTestId('tab-protocol').click();
  await page.getByTestId('protocol-select').selectOption('nmea');
  await page.getByTestId('protocol-live').check();
  await expect(page.getByTestId('protocol-output')).toContainText('GPGGA – Fix data', {
    timeout: 15_000,
  });
});

test('parses frames of the binary simulator and detects bad CRCs', async ({ page }) => {
  await connect(page, 'sim:frames');
  await page.getByTestId('tab-frameparser').click();
  await page.getByTestId('frame-header').fill('AA 55');
  await page
    .getByTestId('page-frameparser')
    .getByRole('button', { name: 'Example: header + length + CRC' })
    .click();
  await page.getByTestId('frame-live').check();
  const out = page.getByTestId('frame-output');
  await expect(out.locator('.ln-ok').first()).toContainText('CRC ✓', { timeout: 10_000 });
  await expect(out.locator('.ln-err').first()).toContainText('CRC ✗', { timeout: 10_000 });
});

test('parses a test telegram', async ({ page }) => {
  await page.getByTestId('tab-frameparser').click();
  await page.getByTestId('frame-example-modbus').click();
  await page.getByTestId('frame-test-parse').click();
  await expect(page.getByTestId('frame-output')).toContainText('CRC ✓ CDC5');
});

test('stops after a number of lines', async ({ page }) => {
  await connect(page, 'sim:sensor', 9600);
  await page.getByTestId('tab-stop').click();
  await page.getByTestId('stop-mode').selectOption('lines');
  const limit = page.getByTestId('page-stop').getByRole('spinbutton');
  await limit.fill('3');
  await limit.press('Enter');
  await page.getByTestId('stop-toggle').click();
  await expect(page.getByTestId('stop-state')).toContainText('triggered: 3 lines received', {
    timeout: 15_000,
  });
  await expect(limit).toBeEnabled();
});

test('stops when a pattern appears and disconnects', async ({ page }) => {
  await connect(page, 'sim:sensor', 9600);
  await page.getByTestId('tab-stop').click();
  await page.getByTestId('stop-pattern').fill('Humidity');
  await page.getByTestId('page-stop').getByText('Also close the connection').click();
  await page.getByTestId('stop-toggle').click();
  await expect(page.getByTestId('stop-state')).toContainText('pattern found (Humidity)');
  await expect(page.getByTestId('connection-state')).toHaveText('disconnected');
});

test.describe('automation', () => {
  test.use({
    seed: {
      automation: [
        { kind: 'log', note: 'start' },
        { kind: 'send', data: 'AT', fmt: 'ASCII', newline: 'CRLF', value: 0 },
        { kind: 'expect', data: 'OK', fmt: 'ASCII', value: 2000 },
        { kind: 'wait', value: 100 },
      ],
    },
  });

  test('sends, waits for the answer and finishes', async ({ page }) => {
    await connect(page, 'sim:sensor', 9600);
    await page.getByTestId('tab-automation').click();
    await page.getByTestId('automation-run').click();
    await expect(page.getByTestId('automation-status')).toHaveText('Sequence finished');
    await expect(page.getByTestId('automation-log')).toContainText('Response received');
  });

  test('aborts when the expected answer does not come', async ({ page }) => {
    await connect(page, 'sim:loopback');
    await page.getByTestId('tab-automation').click();
    await page.getByTestId('automation-run').click();
    await expect(page.getByTestId('automation-status')).toHaveText(
      'Timeout while waiting for the response',
    );
  });
});

test('monitors several ports at once', async ({ page }) => {
  await page.getByTestId('tab-multiport').click();
  await page.getByTestId('slot-port-0').selectOption('sim:gps');
  await page.getByTestId('slot-toggle-0').click();
  await page.getByTestId('slot-port-1').selectOption('sim:loopback');
  await page.getByTestId('slot-toggle-1').click();
  await expect(page.getByTestId('slot-state-0')).toContainText('connected');
  await expect(page.getByTestId('slot-state-1')).toContainText('connected');
  await expect(page.getByTestId('multiport-output')).toContainText('[sim:gps] $GPGGA', {
    timeout: 10_000,
  });
  await page.getByTestId('slot-toggle-0').click();
  await expect(page.getByTestId('slot-state-0')).toContainText('disconnected');
});

test('plots sensor values', async ({ page }) => {
  await connect(page, 'sim:sensor', 9600);
  await page.getByTestId('tab-graph').click();
  await page.getByTestId('graph-record').click();
  const legend = page.getByTestId('graph-legend');
  await expect(legend).toContainText('Temp', { timeout: 10_000 });
  await expect(legend).toContainText('Humidity');
  await expect(legend).toContainText('Pressure');
});
