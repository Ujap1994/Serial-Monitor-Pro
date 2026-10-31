import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, packaged, root, test } from './fixtures';

test('a second instance for the same profile exits without opening another monitor', async ({
  app,
  profile,
  page,
}) => {
  const args = packaged ? ['--simulator'] : [root, '--simulator'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const second = spawn(app.process().spawnfile, args, {
    env: {
      ...process.env,
      SMP_USER_DATA_DIR: profile,
      SMP_NO_LEGACY_IMPORT: '1',
      SMP_NO_UPDATE_CHECK: '1',
    },
    stdio: 'ignore',
  });
  try {
    await expect.poll(() => second.exitCode).toBe(0);
    await expect(page.getByTestId('tab-monitor')).toBeVisible();
    expect(app.windows()).toHaveLength(1);
  } finally {
    if (second.exitCode === null) second.kill();
  }
});

test('closing the last window flushes a just-edited setting and exits on every platform', async ({
  app,
  page,
  profile,
}) => {
  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-header').fill('AA BB');
  // No debounce wait: a close must flush the final edit itself.
  const process = app.process();
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await closed;
  expect(JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).transmitCrc.header).toBe(
    'AA BB',
  );
  await expect.poll(() => process.exitCode).toBe(0);
});
