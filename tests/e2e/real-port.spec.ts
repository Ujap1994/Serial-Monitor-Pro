// Uses a virtual TTY (socat) to exercise the real serial code path of the
// application, including automatic reconnection. Skipped without socat.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';

const hasSocat =
  process.platform !== 'win32' && spawnSync('which', ['socat'], { stdio: 'ignore' }).status === 0;
const path = join(mkdtempSync(join(tmpdir(), 'smp-tty-')), 'tty');
let device: ChildProcess | null = null;

async function startDevice(): Promise<void> {
  device = spawn('socat', [`PTY,link=${path},raw,echo=0`, 'EXEC:cat'], { stdio: 'ignore' });
  await expect.poll(() => existsSync(path)).toBe(true);
}

test.describe('real serial port', () => {
  test.skip(!hasSocat, 'socat is not installed');
  test.use({ seed: { settings: { port: path, autoReconnect: true } } });

  test.beforeEach(startDevice);
  test.afterEach(() => {
    device?.kill();
  });

  test('echoes data and reconnects after the device returns', async ({ page }) => {
    await page.getByTestId('connect-button').click();
    await expect(page.getByTestId('connection-state')).toHaveText('connected');
    await page.getByTestId('send-format').selectOption('ASCII');
    await page.getByTestId('send-input').fill('hello tty');
    await page.getByTestId('send-input').press('Enter');
    const out = page.getByTestId('monitor-output');
    await expect(out.locator('.ln-rx').last()).toContainText('hello tty');

    device?.kill();
    await expect(page.getByTestId('connection-state')).toHaveText('waiting for device …');
    await expect(out.locator('.ln-err').last()).toContainText('Connection to');

    await startDevice();
    await expect(page.getByTestId('connection-state')).toHaveText('connected', { timeout: 10_000 });
    await expect(out.locator('.ln-ok').last()).toContainText('Reconnected');
  });
});
