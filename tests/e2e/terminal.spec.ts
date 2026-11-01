// Terminal mode of the monitor and ANSI colours of device consoles.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeUtf8 } from '@shared/core/bytes';
import { encodeCapture } from '@shared/core/capture';
import { connect, expect, menu, test } from './fixtures';

test('sends every key of the terminal to the device at once', async ({ page }) => {
  await connect(page, 'sim:testdevice');
  await page.getByTestId('monitor-view-terminal').click();
  const terminal = page.getByTestId('terminal');
  await expect(terminal).toBeVisible();
  // The test device ends its commands with LF.
  await page.getByTestId('terminal-enter').selectOption('LF');
  await terminal.click();
  await page.keyboard.type('PING 5');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('PONG 5');
  // Without local echo the typed text itself does not appear.
  await expect(terminal).not.toContainText('PING 5');
  await page.getByTestId('terminal-echo').check();
  await terminal.click();
  await page.keyboard.type('PING 6');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('PING 6');
  await expect(terminal).toContainText('PONG 6');

  // The answers are in the line view as well.
  await page.getByTestId('monitor-view-lines').click();
  await expect(page.getByTestId('monitor-output')).toContainText('PONG 6');
});

test('shows the ANSI colours of a device console and hides other escape sequences', async ({
  app,
  page,
  profile,
}) => {
  // An ESP-IDF style log, recorded as a capture and replayed in time.
  const ESC = '\x1b';
  const log =
    `${ESC}[0;32mI (312) wifi: connected${ESC}[0m\r\n` +
    `${ESC}[0;31mE (400) boot: failed${ESC}[0m\r\n` +
    `${ESC}[2K${ESC}[1Gprogress 100%\r\n`;
  const file = join(profile, 'console.smpcap');
  writeFileSync(
    file,
    encodeCapture({
      header: { format: 'smp-capture', version: 1, created: '', app: 'test' },
      events: [{ t: 100, d: 'rx', data: encodeUtf8(log) }],
    }),
  );
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, file);
  await menu(app, 'replay');
  const dialog = page.getByTestId('replay-dialog');
  await dialog.getByTestId('replay-new-mode-timed').click();
  await dialog.getByTestId('replay-load').click();
  await expect(dialog.getByTestId('replay-list')).toContainText('console.smpcap');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await connect(page, await page.getByTestId('port-select').inputValue());

  const out = page.getByTestId('monitor-output');
  await expect(out.locator('.ansi-fg2').first()).toHaveText('I (312) wifi: connected');
  await expect(out.locator('.ansi-fg1').first()).toHaveText('E (400) boot: failed');
  await expect(out).toContainText('progress 100%');
  await expect(out).not.toContainText('[0;32m');

  // Colours off: the escape sequences are visible again (as dots and text).
  await page.getByTestId('ansi-toggle').uncheck();
  await expect(out).toContainText('.[0;32mI (312) wifi: connected');
  await page.getByTestId('ansi-toggle').check();

  // The terminal shows the same console.
  await page.getByTestId('monitor-view-terminal').click();
  await expect(page.getByTestId('terminal')).toContainText('E (400) boot: failed');
});
