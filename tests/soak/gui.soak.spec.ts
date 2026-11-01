// Long-run test of the user interface with real test devices (or the simulator).
//
//   npm run soak:gui                               simulator, 3 minutes
//   SMP_SOAK_DEVICES=1 SMP_SOAK_MINUTES=480 npm run soak:gui
//
// The application runs as a user would use it, all at once: the Monitor sends a
// CRC frame (Add CRC + header) periodically to the first test device, which
// checks every frame; its sensor stream feeds the graph and its NMEA sentences
// the protocol decoder; the other devices stream into the multi-port slots;
// a trigger watches for rejected frames, the scheduler asks for statistics.
// Every minute memory, DOM size and the reaction time of a tab change are
// recorded. The report goes to soak-reports/<date-time>-gui/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SerialPort } from 'serialport';
import type { Page } from '@playwright/test';
import { expect, launch, makeProfile, test } from '../e2e/fixtures';

const root = join(import.meta.dirname, '..', '..');
const minutes = Number(process.env.SMP_SOAK_MINUTES ?? 3);
const useDevices = Boolean(process.env.SMP_SOAK_DEVICES);
const PERIOD_MS = 250;
const FRAME = '03 11 22 33';

interface Device {
  name: string;
  role: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  path?: string;
}

async function devicePaths(): Promise<{ name: string; path: string }[]> {
  if (!useDevices) return [{ name: 'sim-testdevice', path: 'sim:testdevice' }];
  const file = process.env.SMP_SOAK_CONFIG ?? join(root, 'hardware', 'devices.local.json');
  const local = JSON.parse(readFileSync(file, 'utf8')) as { devices: Device[]; never?: string[] };
  const ports = await SerialPort.list();
  const never = new Set(local.never ?? []);
  return local.devices
    .filter((d) => d.role === 'testdevice' && !(d.serialNumber && never.has(d.serialNumber)))
    .flatMap((d) => {
      const matches = d.path
        ? ports.filter((p) => p.path === d.path)
        : ports.filter(
            (p) =>
              p.serialNumber === d.serialNumber &&
              (!d.vendorId || p.vendorId?.toLowerCase() === d.vendorId.toLowerCase()),
          );
      return matches.length === 1 ? [{ name: d.name, path: matches[0]!.path }] : [];
    });
}

/** Sends one command directly (before the app runs) – used for AUTO. */
async function command(path: string, text: string): Promise<string> {
  const sp = new SerialPort({ path, baudRate: 115200, autoOpen: false });
  await new Promise<void>((res, rej) => sp.open((e) => (e ? rej(e) : res())));
  let got = '';
  sp.on('data', (d: Buffer) => {
    got += d.toString('latin1');
  });
  await new Promise((r) => setTimeout(r, 3500)); // AVR boards restart on open
  sp.write(`${text}\n`);
  await new Promise((r) => setTimeout(r, 500));
  await new Promise<void>((r) => sp.close(() => r()));
  return got.split('\n').find((l) => l.startsWith('OK ')) ?? '';
}

async function switchTab(page: Page, tab: string): Promise<number> {
  const started = Date.now();
  await page.getByTestId(`tab-${tab}`).click();
  await expect(page.getByTestId(`page-${tab}`)).toBeVisible();
  return Date.now() - started;
}

test(`user interface long-run test (${minutes} min)`, async () => {
  const devices = await devicePaths();
  expect(devices.length, 'at least one test device').toBeGreaterThan(0);
  const [main, ...others] = devices;
  const slots = others.slice(0, 4);
  // The slot devices cannot be commanded through multi-port: let them stream by themselves.
  for (const d of slots) expect(await command(d.path, 'AUTO 100')).toBe('OK AUTO 100');

  const profile = makeProfile({
    settings: {
      simulator: !useDevices,
      port: main!.path,
      baud: 115200,
      sendFormat: 'HEX',
      newline: 'None',
      maxLines: 20000,
      periodicMs: PERIOD_MS,
      transmitCrc: {
        enabled: true,
        algorithm: 'CRC-16/MODBUS',
        bigEndian: false,
        position: 0,
        useHeader: true,
        header: 'AA 55',
        includeHeader: false,
      },
      triggers: [
        { name: 'rejected frame', match: 'ASCII', pattern: 'NAK', response: '', cooldownMs: 0 },
      ],
      schedules: [
        { name: 'statistics', intervalS: 60, data: 'STAT?', fmt: 'ASCII', newline: 'LF' },
      ],
    },
    commands: [
      { name: 'Streams on', data: 'STREAM 100', fmt: 'ASCII', newline: 'LF' },
      { name: 'NMEA on', data: 'NMEA 1000', fmt: 'ASCII', newline: 'LF' },
      { name: 'Statistics', data: 'STAT?', fmt: 'ASCII', newline: 'LF' },
      { name: 'Streams off', data: 'STREAM 0', fmt: 'ASCII', newline: 'LF' },
    ],
  });
  const { app, page } = await launch(profile, useDevices ? {} : { SMP_SIMULATED_ONLY: '1' });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const samples: string[] = ['minute;main_mb;renderer_mb;gpu_mb;dom_nodes;tab_ms;tx;rx'];
  const started = Date.now();
  try {
    await page.getByTestId('port-select').selectOption(main!.path);
    await page.getByTestId('connect-button').click();
    await expect(page.getByTestId('connection-state')).toHaveText('connected');
    await page.waitForTimeout(3500); // boot after the DTR reset
    const quick = page.getByTestId('quick-list');
    await quick.getByText('Streams on').click();
    await quick.getByText('NMEA on').click();

    await switchTab(page, 'multiport');
    for (const [i, d] of slots.entries()) {
      await page.getByTestId(`slot-port-${i}`).selectOption(d.path);
      await page.getByTestId(`slot-${i}`).locator('input').fill('115200');
      await page.getByTestId(`slot-${i}`).locator('input').press('Tab');
      await page.getByTestId(`slot-toggle-${i}`).click();
      await expect(page.getByTestId(`slot-state-${i}`)).toContainText('connected');
    }
    await switchTab(page, 'graph');
    await page.getByTestId('graph-record').click();
    await switchTab(page, 'protocol');
    await page.getByTestId('protocol-select').selectOption('nmea');
    await page.getByTestId('protocol-live').check();
    await switchTab(page, 'automation');
    await page.getByTestId('automation-section-triggers').click();
    await page.getByTestId('triggers-on').check();
    await page.getByTestId('automation-section-schedules').click();
    await page.getByTestId('scheduler-on').check();

    await switchTab(page, 'monitor');
    await page.getByTestId('send-input').fill(FRAME);
    await expect(page.getByTestId('send-preview')).toContainText('AA 55 03 11 22 33');
    await page.getByTestId('periodic-toggle').click();
    const periodicStart = Date.now();

    const tabs = ['monitor', 'graph', 'multiport', 'protocol', 'automation'];
    let minute = 0;
    while (Date.now() - started < minutes * 60_000) {
      for (const tab of tabs) {
        await page.waitForTimeout(2000);
        await switchTab(page, tab);
      }
      if (Date.now() - started >= (minute + 1) * 60_000 || minute === 0) {
        const tabMs = await switchTab(page, 'graph');
        // Working set of every process of the application (KB), by process type.
        const metrics = await app.evaluate(({ app: electronApp }) =>
          electronApp.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })),
        );
        const mbOf = (type: string) =>
          (metrics.filter((m) => m.type === type).reduce((n, m) => n + m.kb, 0) / 1024).toFixed(1);
        const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
        const counters = (await page.getByTestId('counters').innerText()).replace(/\s+/g, ' ');
        const tx = /TX ([\d,.]+)/.exec(counters)?.[1] ?? '';
        const rx = /RX ([\d,.]+)/.exec(counters)?.[1] ?? '';
        samples.push(
          `${minute};${mbOf('Browser')};${mbOf('Tab')};${mbOf('GPU')};${nodes};${tabMs};${tx};${rx}`,
        );
        console.info(samples[samples.length - 1]);
        minute++;
      }
    }

    // Stop sending, then compare the device's own counters with what was sent.
    await switchTab(page, 'monitor');
    const sentFor = Date.now() - periodicStart;
    await expect(page.getByTestId('periodic-toggle')).toHaveText('Stop');
    await page.getByTestId('periodic-toggle').click();
    await page.getByTestId('quick-list').getByText('Streams off').click();
    await page.waitForTimeout(500);
    await page.getByTestId('quick-list').getByText('Statistics').click();
    const stat = page
      .getByTestId('monitor-output')
      .getByText(/^STAT uptime=/)
      .last();
    await expect(stat).toBeVisible();
    const statText = (await stat.innerText()).trim();
    const value = (key: string) => Number(new RegExp(`${key}=(\\d+)`).exec(statText)?.[1] ?? NaN);
    await switchTab(page, 'automation');
    await page.getByTestId('automation-section-triggers').click();
    const rejected = await page.getByTestId('trigger-total').innerText();

    // A frame takes up to the period plus the write and the answer.
    const expectedMin = Math.floor((sentFor / (PERIOD_MS + 60)) * 0.9);
    const report = [
      `# User interface long-run test – ${minutes} min`,
      '',
      `Devices: ${devices.map((d) => `${d.name} (${d.path})`).join(', ')}`,
      '',
      `Device counters at the end: \`${statText}\``,
      `Frames accepted by the device: ${value('frames')} (at least ${expectedMin} expected), rejected: ${value('crcerr')}; trigger "rejected frame": ${rejected}`,
      `Console errors: ${errors.length}`,
      '',
      '```',
      ...samples,
      '```',
      '',
      ...errors.slice(0, 20).map((e) => `- ${e}`),
    ].join('\n');
    const dir = join(
      root,
      'soak-reports',
      `${new Date(started).toISOString().replace(/[:]/g, '-').slice(0, 19)}-gui`,
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.md'), report);
    writeFileSync(join(dir, 'samples.csv'), samples.join('\n'));
    console.info(report);

    expect(value('crcerr'), 'frames rejected by the device').toBe(0);
    expect(value('badframes'), 'incomplete frames').toBe(0);
    expect(value('frames'), 'frames accepted by the device').toBeGreaterThanOrEqual(expectedMin);
    expect(rejected).toBe('fired 0×');
    expect(errors, 'console errors').toEqual([]);
  } finally {
    await app.close();
    for (const d of slots)
      if (existsSync(d.path) || d.path.startsWith('sim:'))
        await command(d.path, 'AUTO 0').catch(() => '');
  }
});
