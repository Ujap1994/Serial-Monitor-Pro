import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '@shared/core/settings';
import { connect, expect, launch, makeProfile, menu, test } from './fixtures';

test('controls DTR/RTS and reserves RTS for hardware handshaking', async ({ page }) => {
  await page.getByTestId('flow-select').selectOption('rtscts');
  await expect(page.getByTestId('line-rts')).toBeDisabled();
  await page.getByTestId('flow-select').selectOption('none');
  await connect(page, 'sim:loopback');
  await expect(page.getByTestId('flow-select')).toBeDisabled();
  await page.getByTestId('line-dtr').click();
  await expect(page.getByTestId('line-dtr')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('line-rts').click();
  await expect(page.getByTestId('line-rts')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('line-break').click();
  await expect(page.getByTestId('status-message')).toHaveText('Break signal sent');
});

test('sends a binary file byte for byte without automatic CRC or newline', async ({
  app,
  page,
  profile,
}) => {
  const file = join(profile, 'binary.bin');
  writeFileSync(file, Buffer.from([0, 0xff, 0x41, 0x0d, 0x0a, 0x42]));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
  }, file);
  await connect(page, 'sim:loopback');
  await page.getByTestId('display-format').selectOption('HEX');
  await page.getByTestId('monitor-crc-auto').check();
  await page.getByTestId('send-file').click();
  await page.getByRole('button', { name: 'Choose file …' }).click();
  await page.getByTestId('sendfile-block').fill('2');
  await page.getByTestId('sendfile-block').press('Enter');
  await page.getByTestId('sendfile-start').click();
  await expect(page.getByTestId('sendfile-progress')).toHaveText('6 of 6 bytes');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  const out = page.getByTestId('monitor-output');
  await expect(out).toContainText('File sent: binary.bin');
  await expect(out.locator('.ln-rx').first()).toContainText('00 FF 41 0D 0A');
  await expect(out.locator('.ln-rx').last()).toContainText('42');
  await expect(page.getByTestId('counters')).toContainText('TX 6 B');
  await expect(page.getByTestId('counters')).toContainText('RX 6 B');
});

test('cancels a paused file transfer promptly and disconnects', async ({ app, page, profile }) => {
  const file = join(profile, 'cancel.bin');
  writeFileSync(file, Buffer.alloc(100, 0x41));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
  }, file);
  await connect(page, 'sim:loopback');
  await page.getByTestId('send-file').click();
  await page.getByRole('button', { name: 'Choose file …' }).click();
  await page.getByTestId('sendfile-block').fill('10');
  await page.getByTestId('sendfile-block').press('Enter');
  await page.getByTestId('sendfile-pause').fill('60000');
  await page.getByTestId('sendfile-pause').press('Enter');
  await page.getByTestId('sendfile-start').click();
  await expect(page.getByTestId('sendfile-progress')).toHaveText('10 of 100 bytes');
  await page.getByTestId('sendfile-cancel').click();
  await expect(page.getByTestId('sendfile-start')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByTestId('connection-state')).toHaveText('disconnected');
  await expect(page.getByTestId('monitor-output')).toContainText(
    'Sending cancelled after 10 of 100 bytes',
  );
  await connect(page, 'sim:loopback');
  await page.getByTestId('send-input').fill('42');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('monitor-output').locator('.ln-tx')).toContainText('42 0A');
});

test('shows all newer stable release changes and the download link without executing HTML', async ({
  app,
  page,
  profile,
}) => {
  const feed = join(profile, 'releases.json');
  writeFileSync(
    feed,
    JSON.stringify([
      {
        tag_name: 'v9.2.0',
        name: 'Release 9.2',
        body: '## Changes\n\n- New CRC features\n<script>window.hacked=true</script>',
        published_at: '2026-10-31T00:00:00Z',
      },
      {
        tag_name: 'v9.1.0',
        name: 'Release 9.1',
        body: '## Changes\n\n- Earlier improvements',
        published_at: '2026-10-30T00:00:00Z',
      },
      { tag_name: 'v9.3.0', name: 'Unpublished draft', draft: true },
      { tag_name: 'v9.4.0', name: 'Preview release', prerelease: true },
      { tag_name: 'v1.0.0', name: 'Old release', body: 'Old changes' },
    ]),
  );
  await app.evaluate((_, path) => {
    process.env.SMP_UPDATE_FEED = path;
  }, feed);
  await menu(app, 'check-updates');
  await expect(page.getByTestId('update-summary')).toContainText('Version 9.2.0');
  const changes = page.getByTestId('update-changes');
  await expect(changes).toContainText('New CRC features');
  await expect(changes).toContainText('Earlier improvements');
  await expect(changes).not.toContainText('Unpublished draft');
  await expect(changes).not.toContainText('Preview release');
  await expect(changes).not.toContainText('Old changes');
  await expect(changes.locator('script')).toHaveCount(0);
  await expect(page.getByTestId('update-dialog').locator('a.release-link')).toHaveAttribute(
    'href',
    'https://github.com/Ujap1994/Serial-Monitor-Pro/releases',
  );
});

test('announces a new version at startup until it is skipped or the check is switched off', async () => {
  const profile = makeProfile();
  const feed = join(profile, 'releases.json');
  const release = (version: string) => ({
    tag_name: `v${version}`,
    name: `Release ${version}`,
    body: `### Added\n\n- Feature of ${version}`,
    published_at: '2026-11-01T00:00:00Z',
  });
  writeFileSync(feed, JSON.stringify([release('9.2.0')]));
  const env = { SMP_NO_UPDATE_CHECK: '', SMP_UPDATE_FEED: feed };

  // 1. Startup: the notice appears by itself and lists the changes.
  let run = await launch(profile, env);
  await expect(run.page.getByTestId('update-dialog')).toBeVisible({ timeout: 10_000 });
  await expect(run.page.getByTestId('update-changes')).toContainText('Feature of 9.2.0');
  await run.page.getByTestId('update-skip').check();
  await expect
    .poll(
      () =>
        (JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')) as Settings)
          .updateSkipped,
    )
    .toBe('9.2.0');
  await run.app.close();

  // 2. The skipped version is not announced again …
  run = await launch(profile, env);
  await run.page.waitForTimeout(3500);
  await expect(run.page.getByTestId('update-dialog')).toBeHidden();
  await run.app.close();

  // 3. … but a newer one is.
  writeFileSync(feed, JSON.stringify([release('9.3.0'), release('9.2.0')]));
  run = await launch(profile, env);
  await expect(run.page.getByTestId('update-dialog')).toBeVisible({ timeout: 10_000 });
  await expect(run.page.getByTestId('update-skip')).not.toBeChecked();
  await run.page.keyboard.press('Escape');
  // 4. Switched off in the settings: no check at startup.
  await run.page.getByTestId('open-settings').click();
  await run.page.getByText('Automatic update check at program start').click();
  await run.page.getByTestId('settings-save').click();
  await run.app.close();
  run = await launch(profile, env);
  await run.page.waitForTimeout(3500);
  await expect(run.page.getByTestId('update-dialog')).toBeHidden();
  await run.app.close();
});
