// Launches the real Electron app with simulated devices and an isolated profile.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

export interface Seed {
  settings?: Record<string, unknown>;
  commands?: unknown[];
  automation?: unknown[];
}

export const root = resolve(import.meta.dirname, '../..');

export function makeProfile(seed: Seed = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'smp-e2e-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      language: 'en',
      simulator: true,
      port: 'sim:loopback',
      theme: 'light',
      ...seed.settings,
    }),
  );
  if (seed.commands) writeFileSync(join(dir, 'commands.json'), JSON.stringify(seed.commands));
  if (seed.automation) writeFileSync(join(dir, 'automation.json'), JSON.stringify(seed.automation));
  return dir;
}

/**
 * Set SMP_APP_EXECUTABLE to the path of a packaged build (for example
 * release/linux-unpacked/serial-monitor-pro) to run the tests against it
 * instead of the development build.
 */
export const packaged = process.env.SMP_APP_EXECUTABLE;

export async function launch(profile: string): Promise<{ app: ElectronApplication; page: Page }> {
  const args = packaged ? ['--simulator'] : [root, '--simulator'];
  // Chromium's sandbox needs privileges that CI containers usually lack.
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await electron.launch({
    executablePath: packaged,
    args,
    env: {
      ...process.env,
      SMP_USER_DATA_DIR: profile,
      SMP_NO_LEGACY_IMPORT: '1',
      NODE_ENV: 'production',
    },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900),
  );
  await page.getByTestId('tab-monitor').waitFor();
  return { app, page };
}

/** Sends a menu action exactly like the application menu does. */
export async function menu(app: ElectronApplication, action: string): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0]?.webContents.send('app:menu', a),
    action,
  );
}

export async function connect(page: Page, port: string, baud?: number): Promise<void> {
  await page.getByTestId('port-select').selectOption(port);
  if (baud) {
    await page.getByTestId('baud-input').fill(String(baud));
    await page.getByTestId('baud-input').press('Enter');
  }
  await page.getByTestId('connect-button').click();
  await base.expect(page.getByTestId('connection-state')).toHaveText('connected');
}

export const test = base.extend<{
  seed: Seed;
  app: ElectronApplication;
  page: Page;
  profile: string;
}>({
  seed: [{}, { option: true }],
  profile: async ({ seed }, use) => {
    await use(makeProfile(seed));
  },
  app: async ({ profile }, use) => {
    const { app } = await launch(profile);
    await use(app);
    await app.close();
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await use(page);
  },
});

export const expect = base.expect;
