// Functions of the former Python version that were added back: periodic
// sending, stop actions, triggers, scheduler, macro recording, bridge mode,
// graph statistics/export and decoder statistics/export.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { connect, expect, launch, makeProfile, test } from './fixtures';

async function mockSave(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
  }, path);
}

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

test('sends the Monitor input periodically and stops on request', async ({ page }) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('send-format').selectOption('ASCII');
  await page.getByTestId('send-input').fill('P');
  await page.getByTestId('periodic-ms').fill('100');
  await page.getByTestId('periodic-ms').press('Enter');
  await page.getByTestId('periodic-toggle').click();
  const tx = page.getByTestId('monitor-output').locator('.ln-tx');
  await expect.poll(() => tx.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('tab-monitor').locator('.tab-dot')).toBeVisible();
  await page.getByTestId('periodic-toggle').click();
  await expect(page.getByTestId('monitor-output')).toContainText('Periodic sending stopped');
  const count = await tx.count();
  await page.waitForTimeout(400);
  await expect(tx).toHaveCount(count);
});

test.describe('presets', () => {
  test.use({
    seed: {
      commands: [{ name: 'Ping', data: 'AT', fmt: 'ASCII', newline: 'CRLF', periodicMs: 100 }],
    },
  });

  test('sends a preset periodically with its own interval', async ({ page }) => {
    await connect(page, 'sim:loopback');
    await page.getByTestId('tab-presets').click();
    await expect(page.getByTestId('preset-periodic')).toHaveText('Periodic (100 ms)');
    await page.getByTestId('preset-periodic').click();
    const tx = page.getByTestId('monitor-output').locator('.ln-tx');
    await expect.poll(() => tx.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(3);
    await expect(tx.first()).toContainText('[Ping] AT');
    await page.getByTestId('preset-periodic').click();
    await expect(page.getByTestId('preset-periodic')).toHaveText('Periodic (100 ms)');
  });
});

test('stop condition "pause receiving" freezes the display until resumed', async ({ page }) => {
  await connect(page, 'sim:sensor', 9600);
  await page.getByTestId('tab-stop').click();
  await page.getByTestId('stop-mode').selectOption('lines');
  const limit = page.getByTestId('page-stop').getByRole('spinbutton');
  await limit.fill('2');
  await limit.press('Enter');
  await page.getByTestId('stop-action').selectOption('pause');
  await page.getByTestId('stop-toggle').click();
  await expect(page.getByTestId('stop-resume')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('tab-monitor').click();
  await expect(page.getByTestId('monitor-paused')).toBeVisible();
  const rx = page.getByTestId('monitor-output').locator('.ln-rx');
  const frozen = await rx.count();
  await page.waitForTimeout(800);
  await expect(rx).toHaveCount(frozen);
  await page.getByTestId('monitor-paused').getByRole('button').click();
  await expect(page.getByTestId('monitor-paused')).toBeHidden();
  await expect.poll(() => rx.count(), { timeout: 5000 }).toBeGreaterThan(frozen);
});

test('stop condition "pause and save" writes the Monitor content without a dialog', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smp-capture-'));
  process.env.SMP_CAPTURE_DIR = dir;
  const { app, page } = await launch(makeProfile());
  try {
    await connect(page, 'sim:sensor', 9600);
    await page.getByTestId('tab-stop').click();
    await page.getByTestId('stop-pattern').fill('Humidity');
    await page.getByTestId('stop-action').selectOption('save');
    await page.getByTestId('stop-toggle').click();
    await expect(page.getByTestId('stop-log')).toContainText('Log saved:', { timeout: 10_000 });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^stop_capture_.*\.csv$/);
    const csv = readFileSync(join(dir, files[0]!), 'utf8');
    expect(csv).toContain('Humidity');
    expect(csv).toContain('Stop condition reached');
  } finally {
    delete process.env.SMP_CAPTURE_DIR;
    await app.close();
  }
});

test.describe('automation', () => {
  test.use({
    seed: {
      settings: {
        triggers: [
          {
            name: 'Ack',
            match: 'ASCII',
            pattern: 'PING',
            response: 'PONG',
            fmt: 'ASCII',
            newline: 'None',
            cooldownMs: 0,
          },
        ],
        schedules: [{ name: 'Poll', intervalS: 1, data: 'AT', fmt: 'ASCII', newline: 'None' }],
      },
    },
  });

  test('a trigger answers a received pattern', async ({ page }) => {
    await connect(page, 'sim:loopback');
    await page.getByTestId('tab-automation').click();
    await page.getByTestId('automation-section-triggers').click();
    await expect(page.getByTestId('trigger-list')).toContainText('Ack');
    await page.getByTestId('triggers-on').check();
    await page.getByTestId('tab-monitor').click();
    await page.getByTestId('send-format').selectOption('ASCII');
    await page.getByTestId('send-input').fill('PING');
    await page.getByTestId('send-button').click();
    const tx = page.getByTestId('monitor-output').locator('.ln-tx');
    await expect(tx.last()).toContainText('PONG');
    await page.getByTestId('tab-automation').click();
    await expect(page.getByTestId('trigger-total')).toHaveText('fired 1×');
    await expect(page.getByTestId('automation-log')).toContainText('Trigger "Ack" fired → PONG');
    await page.getByTestId('triggers-on').uncheck();
  });

  test('the scheduler sends at once and then every interval', async ({ page }) => {
    await connect(page, 'sim:loopback');
    await page.getByTestId('tab-automation').click();
    await page.getByTestId('automation-section-schedules').click();
    await page.getByTestId('scheduler-on').check();
    await expect(page.getByTestId('schedule-total')).toHaveText('sent 1×');
    await expect(page.getByTestId('schedule-total')).toHaveText('sent 2×', { timeout: 3000 });
    await page.getByTestId('scheduler-on').uncheck();
    await page.waitForTimeout(1300);
    await expect(page.getByTestId('schedule-total')).toHaveText('sent 2×');
  });

  test('creates a trigger in the editor and validates its pattern', async ({ page }) => {
    await page.getByTestId('tab-automation').click();
    await page.getByTestId('automation-section-triggers').click();
    await page.getByTestId('trigger-new').click();
    await page.getByTestId('trigger-match').selectOption('REGEX');
    await page.getByTestId('trigger-pattern').fill('([');
    await page.getByTestId('trigger-save').click();
    await expect(page.getByTestId('trigger-editor')).toContainText('Pattern:');
    await page.getByTestId('trigger-pattern').fill('^ERR\\d+');
    await page.getByTestId('trigger-name').fill('Error');
    await page.getByTestId('trigger-save').click();
    await expect(page.getByTestId('trigger-list')).toContainText('Error');
  });
});

test('records manual sends as a macro and appends them to the sequence', async ({ page }) => {
  await connect(page, 'sim:loopback');
  await page.getByTestId('tab-automation').click();
  await page.getByTestId('macro-record').click();
  await page.getByTestId('tab-monitor').click();
  await page.getByTestId('send-format').selectOption('ASCII');
  await page.getByTestId('send-newline').selectOption('None');
  for (const text of ['A', 'B']) {
    await page.getByTestId('send-input').fill(text);
    await page.getByTestId('send-button').click();
  }
  await page.getByTestId('tab-automation').click();
  await expect(page.getByTestId('macro-record')).toHaveText('Stop recording (2)');
  await page.getByTestId('macro-record').click();
  const steps = page.getByTestId('step-list');
  await expect(steps).toContainText('Macro of');
  await expect(steps).toContainText('HEX: 41');
  await expect(steps).toContainText('HEX: 42');
  await page.getByTestId('automation-run').click();
  await expect(page.getByTestId('automation-status')).toHaveText('Sequence finished');
});

test('bridge mode forwards what one port receives to another', async ({ page }) => {
  await page.getByTestId('tab-multiport').click();
  await page.getByTestId('slot-port-0').selectOption('sim:gps');
  await page.getByTestId('slot-port-1').selectOption('sim:loopback');
  await page.getByTestId('bridge-from').selectOption('0');
  await page.getByTestId('bridge-to').selectOption('1');
  await page.getByTestId('bridge-on').check();
  await page.getByTestId('slot-toggle-1').click();
  await expect(page.getByTestId('slot-state-1')).toContainText('connected');
  await page.getByTestId('slot-toggle-0').click();
  // The loopback device echoes what the bridge forwarded from the sensor.
  await expect(page.getByTestId('multiport-output')).toContainText('[sim:loopback] $GP', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('bridge-bytes')).not.toHaveText('0 B forwarded');
  await expect(page.getByTestId('slot-counters-1')).not.toContainText('TX 0 B');
  await page.getByTestId('slot-toggle-0').click();
  await page.getByTestId('slot-toggle-1').click();
});

test('the decoder counts valid and invalid packets and exports them', async ({
  app,
  page,
  profile,
}) => {
  await page.getByTestId('tab-protocol').click();
  await page.getByTestId('protocol-example').click();
  await page.getByTestId('protocol-show-invalid').uncheck();
  await page.getByTestId('protocol-input').fill('01 03 00 00 00 0A C5 CE');
  await page.getByTestId('protocol-decode').click();
  const stats = page.getByTestId('protocol-stats');
  await expect(stats).toContainText('2 total');
  await expect(stats).toContainText('1 valid');
  await expect(stats).toContainText('1 invalid');
  await expect(stats).toContainText('50 % valid');
  await expect(page.getByTestId('protocol-output')).not.toContainText('expected');
  const file = join(profile, 'decoded.csv');
  await mockSave(app, file);
  await page.getByTestId('protocol-export').click();
  await expect.poll(() => read(file)).toContain('Modbus RTU;1;01 03 00 00 00 0A C5 CD');
  expect(read(file)).toContain('Modbus RTU;0;01 03 00 00 00 0A C5 CE');

  // Modbus ASCII of the Python version: ":" + hex pairs + LRC.
  await page.getByTestId('protocol-select').selectOption('modbus-ascii');
  await page.getByTestId('protocol-example').click();
  await expect(page.getByTestId('protocol-output')).toContainText('LRC ✓');
  await expect(stats).toContainText('3 total');
});

test('the graph shows statistics and exports the curves', async ({ app, page, profile }) => {
  await connect(page, 'sim:sensor', 9600);
  await page.getByTestId('tab-graph').click();
  await page.getByTestId('graph-record').click();
  await page.getByTestId('graph-stats-toggle').check();
  await expect(page.getByTestId('graph-stats')).toContainText('Temp', { timeout: 10_000 });
  await expect(page.getByTestId('graph-stats')).toContainText('Humidity');
  const file = join(profile, 'graph.csv');
  await mockSave(app, file);
  await page.getByTestId('graph-export').click();
  await expect.poll(() => read(file)).toMatch(/^\uFEFFIndex;Temp;Humidity;Pressure\r\n0;/);
});
