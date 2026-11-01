// Python parity added in 1.2.0: sequence presets, graph channels with own
// patterns and colours, separate multi-port view, decoder details and the
// folder settings.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Settings } from '@shared/core/settings';
import { connect, expect, test } from './fixtures';

test.describe('sequence presets', () => {
  test.use({
    seed: {
      commands: [
        {
          name: 'Init',
          format: 'ASCII',
          is_sequence: true,
          newline: 'None',
          steps: [
            { data: 'AT', format: 'ASCII', pause_ms: 300 },
            { data: '42 43', format: 'HEX', pause_ms: 0 },
          ],
        },
      ],
    },
  });

  test('sends the steps one after another with their pauses', async ({ page }) => {
    await connect(page, 'sim:loopback');
    await expect(page.getByTestId('quick-list')).toContainText('SEQ 2');
    await page.getByTestId('tab-presets').click();
    await expect(page.getByTestId('preset-steps')).toContainText('[ASCII] AT');
    await expect(page.getByTestId('preset-preview')).toContainText('2 steps');
    await page.getByTestId('preset-send').click();
    const tx = page.getByTestId('monitor-output').locator('.ln-tx');
    await expect(tx).toHaveCount(2);
    await expect(tx.nth(0)).toContainText('[Init] AT');
    await expect(tx.nth(1)).toContainText('[Init] BC');
  });

  test('creates a sequence in the command editor', async ({ page }) => {
    await page.getByTestId('tab-presets').click();
    await page.getByTestId('preset-new').click();
    await page.getByTestId('command-name').fill('Chain');
    await page.getByTestId('command-sequence').check();
    await page.getByTestId('command-step-add').click();
    await page.getByTestId('command-step-data-0').fill('ZZ');
    await page.getByTestId('command-save').click();
    await expect(page.getByTestId('command-editor')).toContainText('Step 1:');
    await page.getByTestId('command-step-data-0').fill('01 02');
    await page.getByTestId('command-step-add').click();
    await page.getByTestId('command-step-data-1').fill('03');
    await page.getByTestId('command-save').click();
    await expect(page.getByTestId('preset-list')).toContainText('2 steps');
  });
});

test('graph channels with own patterns and a chosen colour', async ({ page, profile }) => {
  await connect(page, 'sim:sensor', 9600);
  await page.getByTestId('tab-graph').click();
  await page.getByTestId('graph-mode').selectOption('regex');
  await expect(page.getByTestId('graph-channel-name-0')).toHaveValue('Temp');
  await page.getByTestId('graph-channel-name-1').fill('Hum');
  await page.getByTestId('graph-record').click();
  const legend = page.getByTestId('graph-legend');
  await expect(legend).toContainText('Temp', { timeout: 10_000 });
  await expect(legend).toContainText('Hum');
  await expect(legend).not.toContainText('Pressure');
  await page.getByTestId('graph-color-Temp').fill('#00aa00');
  await expect
    .poll(
      () =>
        (JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')) as Partial<Settings>)
          .graph?.channels[0]?.color,
    )
    .toBe('#00aa00');
});

test('multi-port shows every port in its own view', async ({ page }) => {
  await page.getByTestId('tab-multiport').click();
  await page.getByTestId('slot-port-0').selectOption('sim:gps');
  await page.getByTestId('slot-toggle-0').click();
  await page.getByTestId('multiport-view-separate').click();
  await expect(page.getByTestId('multiport-separate')).toBeVisible();
  await expect(page.getByTestId('multiport-output-0')).toContainText('$GP', { timeout: 10_000 });
  await expect(page.getByTestId('multiport-output-1')).not.toContainText('$GP');
  await page.getByTestId('multiport-view-combined').click();
  await expect(page.getByTestId('multiport-output')).toContainText('[sim:gps] $GP');
  await page.getByTestId('slot-toggle-0').click();
});

test('the decoder shows the details of a packet', async ({ page }) => {
  await page.getByTestId('tab-protocol').click();
  await page.getByTestId('protocol-example').click();
  const details = page.getByTestId('protocol-details');
  await expect(details).toContainText('Modbus RTU');
  await expect(details).toContainText('Function 3 (Read Holding Registers)');
  await expect(details).toContainText('0000  01 03 00 00 00 0A C5 CD');
  await expect(details).toContainText('8 bytes');
  await page.getByTestId('protocol-input').fill('01 03 00 00 00 0A C5 CE');
  await page.getByTestId('protocol-decode').click();
  await expect(details).toContainText('invalid');
  // Back to the first packet by clicking it in the list.
  await page.getByTestId('protocol-output').getByRole('option').first().click();
  await expect(details).toContainText('valid');
  await expect(details).not.toContainText('invalid');
  await page.getByTestId('protocol-input').fill('ZZ');
  await page.getByTestId('protocol-decode').click();
  await expect(page.getByTestId('protocol-error')).toContainText('not a valid hexadecimal number');
});

test.describe('folder settings', () => {
  test.use({ seed: { commands: [{ name: 'Mine', data: 'AT', fmt: 'ASCII' }] } });

  test('moves commands to a chosen folder and sets the log folder', async ({ app, page }) => {
    const data = mkdtempSync(join(tmpdir(), 'smp-data-'));
    const logs = mkdtempSync(join(tmpdir(), 'smp-logs-'));
    await page.getByTestId('open-settings').click();
    for (const [key, dir] of [
      ['dataDir', data],
      ['logDir', logs],
    ] as const) {
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
      }, dir);
      await page.getByTestId(`folder-${key}-choose`).click();
      await expect(page.getByTestId(`folder-${key}`)).toContainText(dir);
    }
    await page.getByTestId('settings-save').click();
    await expect.poll(() => existsSync(join(data, 'commands.json'))).toBe(true);
    expect(readFileSync(join(data, 'commands.json'), 'utf8')).toContain('Mine');
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('storage-paths')).toContainText(join(data, 'commands.json'));
    await expect(page.getByTestId('storage-paths')).toContainText(logs);
  });
});
