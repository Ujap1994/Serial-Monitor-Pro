import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, expect, launch, menu, test } from './fixtures';

test('starts with all ten tools', async ({ page }) => {
  for (const id of [
    'monitor',
    'presets',
    'crc',
    'stop',
    'protocol',
    'automation',
    'multiport',
    'sendtable',
    'frameparser',
    'graph',
  ]) {
    await expect(page.getByTestId(`tab-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('connection-state')).toHaveText('disconnected');
});

test('shows the disclaimer in the About dialog', async ({ app, page }) => {
  await menu(app, 'about');
  await expect(page.getByTestId('disclaimer')).toContainText(
    'No liability is accepted for personal injury',
  );
});

test('sends and receives through the loopback device', async ({ page }) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('send-format').selectOption('HEX');
  await page.getByTestId('send-input').fill('41 42 43');
  await page.getByTestId('send-input').press('Enter');
  const out = page.getByTestId('monitor-output');
  await expect(out.locator('.ln-tx')).toContainText('41 42 43 0A');
  await expect(out.locator('.ln-rx').last()).toContainText('ABC');
  await expect(page.getByTestId('counters')).toContainText('RX 4 B');
  await expect(page.getByTestId('counters')).toContainText('TX 4 B');
});

test('re-renders received data when the display format changes', async ({ page }) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('send-format').selectOption('ASCII');
  await page.getByTestId('send-input').fill('Hi');
  await page.getByTestId('send-input').press('Enter');
  const rx = page.getByTestId('monitor-output').locator('.ln-rx').last();
  await expect(rx).toContainText('Hi');
  await page.getByTestId('display-format').selectOption('HEX');
  await expect(rx).toContainText('48 69 0A');
  await page.getByTestId('hexdump-toggle').check();
  await expect(rx).toContainText('00000000  48 69 0A');
});

test('formats hex input while typing', async ({ page }) => {
  await page.getByTestId('send-format').selectOption('HEX');
  await page.getByTestId('send-input').pressSequentially('0a1b2c');
  await expect(page.getByTestId('send-input')).toHaveValue('0A 1B 2C');
});

test('rejects invalid input with an explanation', async ({ page }) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('send-format').selectOption('DEC');
  await page.getByTestId('send-input').fill('999');
  await page.getByTestId('send-input').press('Enter');
  await expect(page.getByTestId('message-dialog')).toContainText('only values from 0 to 255');
});

test('filters and highlights monitor lines', async ({ page }) => {
  await connect(page, 'sim:sensor', 9600);
  const out = page.getByTestId('monitor-output');
  await expect(out.locator('.ln-rx')).not.toHaveCount(0);
  await page.getByTestId('monitor-filter').fill('Pressure');
  await expect(out.locator('mark').first()).toHaveText('Pressure');
  await page.getByTestId('monitor-filter').fill('does-not-exist');
  await expect(out.locator('.ln-rx')).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toContainText('of');
});

test('refuses to open a port that is already in use', async ({ page }) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('tab-multiport').click();
  await page.getByTestId('slot-port-0').selectOption('sim:loopback');
  await page.getByTestId('slot-toggle-0').click();
  await expect(page.getByTestId('message-dialog')).toContainText('already open');
});

test('exports the monitor as text and CSV', async ({ app, page, profile }) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('send-format').selectOption('ASCII');
  await page.getByTestId('send-input').fill('export-me');
  await page.getByTestId('send-input').press('Enter');
  await expect(page.getByTestId('monitor-output').locator('.ln-rx').last()).toContainText(
    'export-me',
  );

  const txt = join(profile, 'out.txt');
  const csv = join(profile, 'out.csv');
  for (const [file, action] of [
    [txt, 'export-txt'],
    [csv, 'export-csv'],
  ] as const) {
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, file);
    await menu(app, action);
    await expect
      .poll(() => {
        try {
          return readFileSync(file, 'utf8');
        } catch {
          return '';
        }
      })
      .toContain('export-me');
  }
  expect(readFileSync(csv, 'utf8')).toMatch(/;RX;10;65 78 70 6F 72 74 2D 6D 65 0A;export-me/);
});

test('remembers settings across restarts', async ({ app, page, profile }) => {
  await page.getByTestId('baud-input').fill('57600');
  await page.getByTestId('baud-input').press('Enter');
  await page.waitForTimeout(600); // settings are written debounced
  await app.close();
  const again = await launch(profile);
  await expect(again.page.getByTestId('baud-input')).toHaveValue('57600');
  await again.app.close();
});

test('switches language and theme', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-language').selectOption('de');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('tab-graph')).toContainText('Diagramm');
  await page.getByTestId('toggle-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('detects the baud rate of the sensor', async ({ app, page }) => {
  await page.getByTestId('port-select').selectOption('sim:sensor');
  await menu(app, 'baud-scan');
  await expect(page.getByTestId('baudscan-best')).toContainText('9600', { timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('baud-input')).toHaveValue('9600');
});
