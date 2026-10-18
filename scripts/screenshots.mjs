#!/usr/bin/env node
// Generates the images in docs/images: the overview picture of the README and
// the annotated pictures of the user guide (English – the documentation on
// GitHub is English only).
//
//   npm run docs:screenshots            (Linux without display: xvfb-run -a …)
//
// The app runs with the simulated devices, a fresh profile and a port list
// that contains nothing but the simulated ports – the images never show the
// devices, paths or names of the computer they are made on. Numbered markers
// are drawn into the page before each shot; the user guide refers to them.
// With pngquant installed, the images are compressed afterwards.

/* global document, innerWidth, innerHeight -- drawMarkers() and the cleanup run in the page */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const images = join(root, 'docs', 'images');
const ACCENT = '#f97316';
const written = [];

/** Texts of the interface, read from the translation files. */
function messages(lang) {
  const src = readFileSync(join(root, 'src', 'shared', 'i18n', `${lang}.ts`), 'utf8');
  const map = new Map();
  for (const [, key, value] of src.matchAll(/^\s*'([^']+)':\s*\n?\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)) {
    map.set(
      key,
      value.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c)),
    );
  }
  return (key) => {
    if (!map.has(key)) throw new Error(`no ${lang} text for ${key}`);
    return map.get(key);
  };
}

const [PING, INFO, MODBUS, RESTART] = [
  'AT – ping',
  'Device info',
  'Modbus: read 10 registers',
  'Restart',
];
const COMMANDS = [
  { name: PING, data: 'AT', fmt: 'ASCII', newline: 'CRLF', delayMs: 400, enabled: true },
  { name: INFO, data: 'ATI', fmt: 'ASCII', newline: 'CRLF', delayMs: 400, enabled: true },
  {
    name: MODBUS,
    data: '01 03 00 00 00 0A C5 CD',
    fmt: 'HEX',
    newline: 'None',
    delayMs: 500,
    enabled: true,
  },
  { name: RESTART, data: 'AT+RST', fmt: 'ASCII', newline: 'CRLF', delayMs: 1000, enabled: false },
];

const STEPS = [
  { kind: 'log', note: 'Self-test of the sensor' },
  { kind: 'send', data: 'AT', fmt: 'ASCII', newline: 'CRLF', value: 0 },
  { kind: 'expect', data: 'OK', fmt: 'ASCII', value: 1000 },
  { kind: 'wait', value: 300 },
  { kind: 'send', data: 'ATI', fmt: 'ASCII', newline: 'CRLF', value: 0 },
  { kind: 'expect', data: 'Simulator', fmt: 'ASCII', value: 1000 },
  { kind: 'log', note: 'Sensor answers correctly' },
];

async function start({ theme = 'light', settings = {} } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'smp-shots-'));
  writeFileSync(
    join(profile, 'settings.json'),
    JSON.stringify({
      language: 'en',
      theme,
      simulator: true,
      port: 'sim:sensor',
      baud: 9600,
      ...settings,
    }),
  );
  writeFileSync(join(profile, 'commands.json'), JSON.stringify(COMMANDS));
  writeFileSync(join(profile, 'automation.json'), JSON.stringify(STEPS));
  const args = [root, '--simulator', '--force-device-scale-factor=1.25'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await electron.launch({
    args,
    env: {
      ...process.env,
      SMP_USER_DATA_DIR: profile,
      SMP_NO_LEGACY_IMPORT: '1',
      SMP_SIMULATED_ONLY: '1',
    },
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

async function connect(page, port, baud) {
  await page.getByTestId('port-select').selectOption(port);
  if (baud) {
    await page.getByTestId('baud-input').fill(String(baud));
    await page.getByTestId('baud-input').press('Enter');
  }
  await page.getByTestId('connect-button').click();
  await page
    .getByTestId('connection-state')
    .filter({ hasText: /^connected$/ })
    .waitFor();
}

/** Bounding box around every element of the given locator(s). */
async function boxOf(target) {
  const boxes = [];
  for (const locator of [target].flat()) {
    for (const element of await locator.all()) {
      const b = await element.boundingBox();
      if (b && b.width > 0 && b.height > 0) boxes.push(b);
    }
  }
  if (!boxes.length) throw new Error(`marker target not visible: ${[target].flat().join(', ')}`);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Runs in the page: draws a frame and a numbered badge per marker. */
function drawMarkers({ items, accent }) {
  const layer = document.createElement('div');
  layer.id = 'doc-markers';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const R = 12;
  for (const { n, box, at } of items) {
    const pad = 3;
    const left = box.x - pad;
    const top = box.y - pad;
    const width = box.width + 2 * pad;
    const height = box.height + 2 * pad;
    const ring = document.createElement('div');
    ring.style.cssText =
      `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;` +
      `border:2.5px solid ${accent};border-radius:8px;box-shadow:0 0 0 1.5px rgba(255,255,255,.9)`;
    let cx = at.includes('r') ? left + width : left;
    let cy = at.includes('b') ? top + height : top;
    if (at === 'l' || at === 'r') cy = top + height / 2;
    cx = Math.min(Math.max(cx, R + 3), innerWidth - R - 3);
    cy = Math.min(Math.max(cy, R + 3), innerHeight - R - 3);
    const badge = document.createElement('div');
    badge.textContent = String(n);
    badge.style.cssText =
      `position:fixed;left:${cx - R}px;top:${cy - R}px;width:${2 * R}px;height:${2 * R}px;` +
      `border-radius:50%;background:${accent};color:#fff;border:2px solid #fff;` +
      `font:700 13px/${2 * R - 4}px Inter,system-ui,sans-serif;text-align:center;` +
      'box-shadow:0 1px 5px rgba(0,0,0,.4)';
    layer.append(ring, badge);
  }
  document.body.append(layer);
}

/**
 * Saves a screenshot. Markers are numbered in the order given – the guide
 * explains them in the same order. A marker is a locator, a list of locators
 * (framed together) or { target, at } with the badge corner tl/tr/bl/br/l/r.
 */
async function shot(page, file, markers = []) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const items = [];
  for (const [i, marker] of markers.entries()) {
    const { target, at = 'tl' } = marker && marker.target ? marker : { target: marker };
    items.push({ n: i + 1, box: await boxOf(target), at });
  }
  if (items.length) await page.evaluate(drawMarkers, { items, accent: ACCENT });
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  if (items.length) await page.evaluate(() => document.getElementById('doc-markers')?.remove());
  written.push(file);
  console.log(`  ✓ ${relative(root, file)}`);
}

async function guide() {
  const m = messages('en');
  const file = (name) => join(images, 'guide', `${name}.png`);
  const id = (testId) => (page) => page.getByTestId(testId);
  // By the exact caption – a plain text match would also hit select options.
  const field = (scope, label) =>
    scope.locator('label.field', { has: scope.page().getByText(label, { exact: true }) });
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });

  // ── Window, monitor, presets, send table, automation, stop, CRC, graph ────
  {
    const { app, page } = await start({ settings: { deltaTime: true } });
    const $ = (testId) => id(testId)(page);
    await connect(page, 'sim:sensor', 9600);
    await page.waitForTimeout(2600);
    await $('quick-list').getByText(PING).click();
    await page.waitForTimeout(1300);
    await $('quick-list').getByText(INFO).click();
    await page.waitForTimeout(1600);
    await shot(page, join(images, 'monitor.png'));

    const groups = page.locator('.conn-group');
    await shot(page, file('window'), [
      $('port-select'),
      page.getByTitle(/\(F5\)$/),
      { target: [groups.nth(1), groups.nth(2)], at: 'bl' },
      $('connect-button'),
      groups.nth(3).locator('button').nth(1),
      $('connection-state'),
      page.locator('nav.tabbar [role="tab"]'),
      { target: $('toggle-theme'), at: 'bl' },
      { target: $('open-settings'), at: 'br' },
      { target: $('status-message'), at: 'tr' },
      { target: $('counters'), at: 'tl' },
    ]);

    await shot(page, file('monitor'), [
      page.locator('.card.quick'),
      $('monitor-output'),
      $('display-format'),
      page.locator('.opts label'),
      $('monitor-filter'),
      page.getByTitle(/\(Ctrl\+L\)$/),
      page.locator('.monitor-main .row.nowrap > button').first(),
      $('send-format'),
      $('send-input'),
      page.locator('.sendbar select').nth(1),
      { target: $('send-button'), at: 'tr' },
    ]);

    await $('monitor-filter').fill('OK');
    await page.waitForTimeout(300);
    await shot(page, file('monitor-filter'), [$('monitor-filter'), $('filter-count')]);
    await $('monitor-filter').fill('');

    await $('tab-presets').click();
    const presets = $('page-presets');
    await $('preset-list').getByText(MODBUS).click();
    await shot(page, file('presets'), [
      [
        button(presets, m('common.new')),
        button(presets, m('common.edit')),
        button(presets, m('common.duplicate')),
        button(presets, m('common.delete')),
      ],
      [presets.getByTitle(m('common.moveUp')), presets.getByTitle(m('common.moveDown'))],
      $('preset-list'),
      presets.locator('dl.detail'),
      presets.locator('.preview'),
      $('preset-send'),
      [button(presets, m('common.import')), button(presets, m('common.export'))],
    ]);

    await button(presets, m('common.edit')).click();
    const editor = $('command-editor');
    await editor.waitFor();
    await shot(page, file('command-editor'), [
      $('command-name'),
      field(editor, m('command.format')),
      $('command-data'),
      field(editor, m('command.newline')),
      field(editor, m('command.delay')),
      $('command-preview'),
      $('command-save'),
    ]);
    await page.keyboard.press('Escape');

    await $('tab-sendtable').click();
    const sendtable = $('page-sendtable');
    await sendtable.getByText(m('common.repeat'), { exact: true }).click();
    await $('sendtable-run').click();
    await page.waitForTimeout(900);
    await shot(page, file('sendtable'), [
      $('send-table').locator('tbody tr td:first-child'),
      $('send-table').locator('tbody tr td:last-child'),
      $('sendtable-run'),
      sendtable.locator('label', { hasText: m('common.repeat') }),
      $('sendtable-status'),
      button(sendtable, m('sendtable.sendSelected')),
    ]);
    await $('sendtable-run').click();

    await $('tab-automation').click();
    const automation = $('page-automation');
    await $('automation-run').click();
    await page.waitForTimeout(2500);
    await shot(page, file('automation'), [
      $('step-list'),
      [
        button(automation, m('common.new')),
        button(automation, m('common.edit')),
        button(automation, m('common.delete')),
      ],
      [automation.getByTitle(m('common.moveUp')), automation.getByTitle(m('common.moveDown'))],
      $('automation-run'),
      automation.locator('label', { hasText: m('automation.repeat') }),
      $('automation-status'),
      $('automation-log'),
    ]);
    await $('step-list').locator('[role="option"], li, .list-item').nth(2).click();
    await button(automation, m('common.edit')).click();
    const stepEditor = $('step-editor');
    await stepEditor.waitFor();
    await shot(page, file('step-editor'), [
      $('step-kind'),
      $('step-data'),
      field(stepEditor, m('step.timeout')),
      stepEditor.getByText(m('step.hint.expect')),
      $('step-save'),
    ]);
    await page.keyboard.press('Escape');

    await $('tab-stop').click();
    const stop = $('page-stop');
    await $('stop-pattern').fill('Humidity');
    await $('stop-toggle').click();
    await page.waitForTimeout(1500);
    await shot(page, file('stop'), [
      $('stop-mode'),
      [$('stop-pattern'), stop.locator('select').nth(1)],
      stop.locator('label', { hasText: m('stop.alsoDisconnect') }),
      $('stop-toggle'),
      $('stop-state'),
      $('stop-log'),
    ]);

    await $('tab-crc').click();
    const crc = $('page-crc');
    await $('crc-input').fill('01 03 00 00 00 0A');
    await shot(page, file('crc'), [
      $('crc-format'),
      $('crc-algo'),
      $('crc-input'),
      button(crc, m('crc.single')),
      $('crc-compare'),
      $('crc-check-vector'),
      $('crc-result'),
    ]);
    await $('crc-compare').click();
    await shot(page, file('crc-compare'), [$('crc-table')]);

    await $('tab-graph').click();
    const graph = $('page-graph');
    await $('graph-record').click();
    await page.waitForTimeout(9000);
    // Pressure (≈ 1013) would flatten the other curves – hidden via the legend.
    await $('graph-legend').getByText('Pressure').click();
    await shot(page, file('graph'), [
      $('graph-record'),
      field(graph, m('graph.detection')),
      field(graph, m('graph.separator')),
      field(graph, m('graph.points')),
      button(graph, m('graph.clear')),
      $('graph-legend'),
      $('graph-canvas'),
    ]);

    await $('tab-monitor').click();
    await $('connect-button').click();
    await menu(app, 'baud-scan');
    await $('baudscan-best').waitFor({ timeout: 20_000 });
    await shot(page, file('baudscan'), [
      $('baudscan-results'),
      $('baudscan-best'),
      button($('baudscan-dialog'), m('scan.again')),
    ]);
    await page.keyboard.press('Escape');

    await $('open-settings').click();
    await $('settings-dialog').waitFor();
    const sections = $('settings-dialog').locator('.section-title');
    // General, display, hex input, sending, connection – storage is further down.
    await shot(
      page,
      file('settings'),
      [0, 1, 2, 3, 4].map((i) => sections.nth(i)),
    );
    await page.keyboard.press('Escape');

    await menu(app, 'about');
    const about = $('about-dialog');
    await about.waitFor();
    // Anonymous documentation: no names in the pictures.
    await about.getByText('©', { exact: false }).evaluate((el) => {
      el.style.display = 'none';
    });
    await shot(page, file('about'), [
      $('disclaimer'),
      [m('menu.docs'), m('menu.issue'), m('about.license')].map((name) => button(page, name)),
    ]);
    await app.close();
  }

  // ── Protocol decoder, frame parser, multi-port ─────────────────────────────
  {
    const { app, page } = await start();
    const $ = (testId) => id(testId)(page);
    await connect(page, 'sim:gps');
    await $('tab-protocol').click();
    const protocol = $('page-protocol');
    await $('protocol-select').selectOption('modbus');
    await $('protocol-example').click();
    await shot(page, file('protocol'), [
      $('protocol-select'),
      $('protocol-input'),
      $('protocol-decode'),
      $('protocol-example'),
      page.locator('label', { has: $('protocol-live') }),
      $('protocol-output'),
    ]);
    await button(protocol, m('common.clearOutput')).click();
    await $('protocol-select').selectOption('nmea');
    await $('protocol-live').check();
    await page.waitForTimeout(3500);
    await shot(page, file('protocol-nmea'), [
      $('protocol-select'),
      page.locator('label', { has: $('protocol-live') }),
      $('protocol-output'),
    ]);
    await $('connect-button').click();

    await connect(page, 'sim:frames');
    await $('tab-frameparser').click();
    const frames = $('page-frameparser');
    await button(frames, m('frames.exampleHeaderButton')).click();
    await $('frame-live').check();
    await page.waitForTimeout(5000);
    await shot(page, file('frameparser'), [
      field(frames, m('frames.header')),
      field(frames, m('frames.footer')),
      field(frames, m('frames.lengthField')),
      field(frames, m('frames.counts')),
      field(frames, m('frames.crc')),
      field(frames, m('frames.byteOrder')),
      field(frames, m('frames.fixedLength')),
      page.locator('label', { has: $('frame-live') }),
      [
        button(frames, m('frames.exampleModbusButton')),
        button(frames, m('frames.exampleHeaderButton')),
      ],
      [$('frame-test-input'), $('frame-test-parse')],
      $('frame-output'),
      { target: frames.locator('.page-header .badge'), at: 'bl' },
    ]);
    await $('connect-button').click();

    await $('tab-multiport').click();
    for (const [i, port, baud] of [
      [0, 'sim:gps'],
      [1, 'sim:sensor', 9600],
      [2, 'sim:loopback'],
    ]) {
      await $(`slot-port-${i}`).selectOption(port);
      if (baud) {
        const input = $(`slot-${i}`).locator('input');
        await input.fill(String(baud));
        await input.press('Tab');
      }
      await $(`slot-toggle-${i}`).click();
    }
    await page.waitForTimeout(3500);
    const multiport = $('page-multiport');
    await shot(page, file('multiport'), [
      [0, 1, 2, 3].map((i) => $(`slot-${i}`)),
      $('slot-port-3'),
      $('slot-3').locator('input'),
      $('slot-toggle-3'),
      $('slot-state-0'),
      $('multiport-output'),
      { target: multiport.locator('.page-header button'), at: 'tr' },
    ]);
    await app.close();
  }

  // ── Dark appearance with hex dump ──────────────────────────────────────────
  {
    const { app, page } = await start({
      theme: 'dark',
      settings: { display: 'HEX', deltaTime: true, hexdump: true, rxSplit: 'packet' },
    });
    await connect(page, 'sim:frames');
    await page.waitForTimeout(4500);
    await shot(page, file('dark-hexdump'));
    await app.close();
  }
}

console.log('Generating screenshots …');
await guide();

if (spawnSync('pngquant', ['--version'], { stdio: 'ignore' }).status === 0) {
  const before = written.reduce((sum, f) => sum + statSync(f).size, 0);
  spawnSync(
    'pngquant',
    ['--force', '--skip-if-larger', '--quality=80-98', '--ext=.png', ...written],
    {
      stdio: 'inherit',
    },
  );
  const after = written.reduce((sum, f) => sum + statSync(f).size, 0);
  console.log(`\npngquant: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
} else {
  console.log('\n(pngquant not installed – images left uncompressed)');
}
console.log('Done.');
process.exit(0);
