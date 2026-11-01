// Session capture in the monitor and its replay as a simulated device.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCapture } from '@shared/core/capture';
import { connect, expect, menu, test } from './fixtures';

test('records a session and replays it as a device that answers like the original', async ({
  app,
  page,
  profile,
}) => {
  const file = join(profile, 'session.smpcap');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, file);

  // Record: ask the simulated test device for its identity.
  await connect(page, 'sim:testdevice');
  await page.getByTestId('send-format').selectOption('ASCII');
  await page.getByTestId('send-newline').selectOption('LF');
  await page.getByTestId('capture-toggle').check();
  await expect(page.getByTestId('status-message')).toContainText('Capture running');
  await page.getByTestId('send-input').fill('ID?');
  await page.getByTestId('send-input').press('Enter');
  const out = page.getByTestId('monitor-output');
  await expect(out).toContainText('ID SMP-TD/1 board=simulator');
  await page.getByTestId('capture-toggle').uncheck();
  await expect(page.getByTestId('status-message')).toContainText('Capture saved');

  expect(existsSync(file)).toBe(true);
  const capture = parseCapture(readFileSync(file, 'utf8'));
  expect(capture.header.port?.path).toBe('sim:testdevice');
  const tx = capture.events.filter((e) => e.d === 'tx');
  expect(tx.length).toBeGreaterThan(0);
  expect(capture.events.some((e) => e.d === 'rx')).toBe(true);

  // Replay: the capture becomes a port; it answers ID? with the recorded line.
  await page.getByTestId('connect-button').click();
  await expect(page.getByTestId('connection-state')).toHaveText('disconnected');
  await menu(app, 'replay');
  const dialog = page.getByTestId('replay-dialog');
  await expect(dialog.getByTestId('replay-none')).toBeVisible();
  await dialog.getByTestId('replay-load').click();
  await expect(dialog.getByTestId('replay-list')).toContainText('session.smpcap');
  await expect(dialog.getByTestId('replay-list')).toContainText('sim:replay-');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();

  const recordedId = (
    await out.locator('.ln-rx .ln-text').filter({ hasText: 'ID SMP-TD/1' }).last().innerText()
  ).trim();
  await menu(app, 'clear');
  const port = await page.getByTestId('port-select').inputValue();
  expect(port).toMatch(/^sim:replay-\d+$/);
  await connect(page, port);
  await page.getByTestId('send-input').fill('ID?');
  await page.getByTestId('send-input').press('Enter');
  await expect(out.locator('.ln-rx .ln-text').filter({ hasText: 'ID SMP-TD/1' })).toHaveText(
    recordedId,
  );

  // Removing the replay closes it and takes it out of the port list.
  await menu(app, 'replay');
  await dialog.getByTestId(`replay-remove-${port}`).click();
  await expect(dialog.getByTestId('replay-none')).toBeVisible();
  await expect(page.getByTestId('connection-state')).not.toHaveText('connected');
  const ports = await page.evaluate(() =>
    (
      window as unknown as {
        smp: { serial: { list(simulated: boolean): Promise<{ path: string }[]> } };
      }
    ).smp.serial.list(true),
  );
  expect(ports.map((p) => p.path)).not.toContain(port);
});
