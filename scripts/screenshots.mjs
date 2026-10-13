#!/usr/bin/env node
// Generates the screenshots in docs/images with the simulated devices.
//
//   npm run docs:screenshots            (Linux without display: xvfb-run -a …)
//
// Every image is reproducible – re-run this script after UI changes.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'images');
mkdirSync(out, { recursive: true });

const COMMANDS = {
  en: [
    { name: 'AT – ping', data: 'AT', fmt: 'ASCII', newline: 'CRLF', delayMs: 400, enabled: true },
    {
      name: 'Device info',
      data: 'ATI',
      fmt: 'ASCII',
      newline: 'CRLF',
      delayMs: 400,
      enabled: true,
    },
    {
      name: 'Modbus: read 10 registers',
      data: '01 03 00 00 00 0A C5 CD',
      fmt: 'HEX',
      newline: 'None',
      delayMs: 500,
      enabled: true,
    },
    {
      name: 'Restart',
      data: 'AT+RST',
      fmt: 'ASCII',
      newline: 'CRLF',
      delayMs: 1000,
      enabled: false,
    },
  ],
  de: [
    { name: 'AT – Ping', data: 'AT', fmt: 'ASCII', newline: 'CRLF', delayMs: 400, enabled: true },
    { name: 'Geräteinfo', data: 'ATI', fmt: 'ASCII', newline: 'CRLF', delayMs: 400, enabled: true },
    {
      name: 'Modbus: 10 Register lesen',
      data: '01 03 00 00 00 0A C5 CD',
      fmt: 'HEX',
      newline: 'None',
      delayMs: 500,
      enabled: true,
    },
    {
      name: 'Neustart',
      data: 'AT+RST',
      fmt: 'ASCII',
      newline: 'CRLF',
      delayMs: 1000,
      enabled: false,
    },
  ],
};

const STEPS = [
  { kind: 'log', note: 'Self-test of the sensor' },
  { kind: 'send', data: 'AT', fmt: 'ASCII', newline: 'CRLF', value: 0 },
  { kind: 'expect', data: 'OK', fmt: 'ASCII', value: 1000 },
  { kind: 'wait', value: 300 },
  { kind: 'send', data: 'ATI', fmt: 'ASCII', newline: 'CRLF', value: 0 },
  { kind: 'expect', data: 'Simulator', fmt: 'ASCII', value: 1000 },
  { kind: 'log', note: 'Sensor answers correctly' },
];

async function start({ lang = 'en', theme = 'light', settings = {} } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'smp-shots-'));
  writeFileSync(
    join(profile, 'settings.json'),
    JSON.stringify({
      language: lang,
      theme,
      simulator: true,
      port: 'sim:sensor',
      baud: 9600,
      ...settings,
    }),
  );
  writeFileSync(join(profile, 'commands.json'), JSON.stringify(COMMANDS[lang]));
  writeFileSync(join(profile, 'automation.json'), JSON.stringify(STEPS));
  const args = [root, '--simulator', '--force-device-scale-factor=1.5'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await electron.launch({
    args,
    env: { ...process.env, SMP_USER_DATA_DIR: profile, SMP_NO_LEGACY_IMPORT: '1' },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800),
  );
  await page.getByTestId('tab-monitor').waitFor();
  await page.waitForTimeout(400);
  return { app, page };
}

const menu = (app, action) =>
  app.evaluate(
    ({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0]?.webContents.send('app:menu', a),
    action,
  );

async function shot(page, name) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`  ✓ docs/images/${name}.png`);
}

async function connect(page, port, baud) {
  await page.getByTestId('port-select').selectOption(port);
  if (baud) {
    await page.getByTestId('baud-input').fill(String(baud));
    await page.getByTestId('baud-input').press('Enter');
  }
  await page.getByTestId('connect-button').click();
  await page
    .getByTestId('connection-state')
    .filter({ hasText: /connected|verbunden/ })
    .waitFor();
}

console.log('Generating screenshots …');

// ── Monitor, light, English ──────────────────────────────────────────────────
{
  const { app, page } = await start({ settings: { deltaTime: true } });
  await connect(page, 'sim:sensor', 9600);
  await page.waitForTimeout(2600);
  await page.getByTestId('quick-list').getByText('AT – ping').click();
  await page.waitForTimeout(1300);
  await page.getByTestId('quick-list').getByText('Device info').click();
  await page.waitForTimeout(1600);
  await shot(page, 'monitor');

  await page.getByTestId('monitor-filter').fill('OK');
  await page.waitForTimeout(300);
  await shot(page, 'monitor-filter');
  await page.getByTestId('monitor-filter').fill('');

  await page.getByTestId('tab-presets').click();
  await page.getByTestId('preset-list').getByText('Modbus: read 10 registers').click();
  await shot(page, 'presets');

  await page.getByTestId('tab-sendtable').click();
  await page.getByTestId('page-sendtable').getByText('Repeat', { exact: true }).click();
  await page.getByTestId('sendtable-run').click();
  await page.waitForTimeout(700);
  await shot(page, 'sendtable');
  await page.getByTestId('sendtable-run').click();

  await page.getByTestId('tab-automation').click();
  await page.getByTestId('automation-run').click();
  await page.waitForTimeout(2500);
  await shot(page, 'automation');

  await page.getByTestId('tab-stop').click();
  await page.getByTestId('stop-pattern').fill('Humidity:5');
  await page.getByTestId('stop-toggle').click();
  await page.waitForTimeout(4000);
  await shot(page, 'stop');

  await page.getByTestId('tab-crc').click();
  await page.getByTestId('crc-input').fill('01 03 00 00 00 0A');
  await shot(page, 'crc');
  await page.getByTestId('crc-compare').click();
  await shot(page, 'crc-compare');

  await page.getByTestId('tab-graph').click();
  await page.getByTestId('graph-record').click();
  await page.waitForTimeout(9000);
  await shot(page, 'graph');

  await page.getByTestId('tab-monitor').click();
  await page.getByTestId('connect-button').click();
  await menu(app, 'baud-scan');
  await page.getByTestId('baudscan-best').waitFor({ timeout: 20_000 });
  await shot(page, 'baudscan');
  await page.keyboard.press('Escape');

  await page.getByTestId('open-settings').click();
  await shot(page, 'settings');
  await page.keyboard.press('Escape');

  await menu(app, 'about');
  await page.getByTestId('about-dialog').waitFor();
  await shot(page, 'about');
  await app.close();
}

// ── Protocol, frames and multi-port ─────────────────────────────────────────
{
  const { app, page } = await start();
  await connect(page, 'sim:gps');
  await page.getByTestId('tab-protocol').click();
  await page.getByTestId('protocol-example').click();
  await page.getByTestId('protocol-select').selectOption('nmea');
  await page.getByTestId('protocol-live').check();
  await page.waitForTimeout(3500);
  await shot(page, 'protocol');
  await page.getByTestId('connect-button').click();

  await connect(page, 'sim:frames');
  await page.getByTestId('tab-frameparser').click();
  await page
    .getByTestId('page-frameparser')
    .getByRole('button', { name: 'Example: header + length + CRC' })
    .click();
  await page.getByTestId('frame-live').check();
  await page.waitForTimeout(5000);
  await shot(page, 'frameparser');
  await page.getByTestId('connect-button').click();

  await page.getByTestId('tab-multiport').click();
  for (const [i, port, baud] of [
    [0, 'sim:gps'],
    [1, 'sim:sensor', 9600],
    [2, 'sim:loopback'],
  ]) {
    await page.getByTestId(`slot-port-${i}`).selectOption(port);
    if (baud) {
      const input = page.getByTestId(`slot-${i}`).locator('input');
      await input.fill(String(baud));
      await input.press('Tab');
    }
    await page.getByTestId(`slot-toggle-${i}`).click();
  }
  await page.waitForTimeout(3500);
  await shot(page, 'multiport');
  await app.close();
}

// ── Dark theme ───────────────────────────────────────────────────────────────
{
  const { page } = await start({ theme: 'dark', settings: { display: 'HEX', deltaTime: true } });
  await connect(page, 'sim:frames');
  await page.waitForTimeout(4500);
  await shot(page, 'monitor-dark');
  await page.getByTestId('connect-button').click();
  await page.getByTestId('display-format').selectOption('ASCII');
  await connect(page, 'sim:sensor', 9600);
  await page.getByTestId('tab-graph').click();
  await page.getByTestId('graph-record').click();
  await page.waitForTimeout(9000);
  await shot(page, 'graph-dark');
  await page.context().browser()?.close();
}

// ── German ───────────────────────────────────────────────────────────────────
{
  const { app, page } = await start({ lang: 'de' });
  await connect(page, 'sim:sensor', 9600);
  await page.waitForTimeout(2500);
  await page.getByTestId('quick-list').getByText('AT – Ping').click();
  await page.waitForTimeout(1500);
  await shot(page, 'monitor-de');
  await app.close();
}

console.log('Done.');
process.exit(0);
