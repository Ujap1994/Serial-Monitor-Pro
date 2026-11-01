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
// The multi-port bridge forwards the stream of one slot to a loopback adapter
// (RX and TX bridged) in the last slot: every forwarded byte must come back.
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

interface Found {
  name: string;
  path: string;
  role: string;
}

async function devicePaths(): Promise<Found[]> {
  if (!useDevices) return [{ name: 'sim-testdevice', path: 'sim:testdevice', role: 'testdevice' }];
  const file = process.env.SMP_SOAK_CONFIG ?? join(root, 'hardware', 'devices.local.json');
  const local = JSON.parse(readFileSync(file, 'utf8')) as { devices: Device[]; never?: string[] };
  const ports = await SerialPort.list();
  const never = new Set(local.never ?? []);
  return local.devices
    .filter((d) => !(d.serialNumber && never.has(d.serialNumber)))
    .flatMap((d) => {
      const matches = d.path
        ? ports.filter((p) => p.path === d.path)
        : ports.filter(
            (p) =>
              p.serialNumber === d.serialNumber &&
              (!d.vendorId || p.vendorId?.toLowerCase() === d.vendorId.toLowerCase()),
          );
      return matches.length === 1 ? [{ name: d.name, path: matches[0]!.path, role: d.role }] : [];
    });
}

const PROBE = 'SMP loopback probe\r\n';

/** A loopback adapter must return a probe unchanged before it gets anything else. */
async function probeLoopback(path: string): Promise<boolean> {
  const sp = new SerialPort({ path, baudRate: 115200, autoOpen: false });
  await new Promise<void>((res, rej) => sp.open((e) => (e ? rej(e) : res())));
  let got = '';
  sp.on('data', (d: Buffer) => {
    got += d.toString('latin1');
  });
  sp.write(PROBE);
  const until = Date.now() + 1000;
  while (Date.now() < until && got.length < PROBE.length)
    await new Promise((r) => setTimeout(r, 20));
  await new Promise<void>((r) => sp.close(() => r()));
  return got === PROBE;
}

/** "RX 1,234 B · TX 56 B" → { rx: 1234, tx: 56 } */
function counterValues(text: string): { rx: number; tx: number } {
  const value = (key: string) =>
    Number((new RegExp(`${key}\\s*([\\d.,\\s]+)\\s*B`).exec(text)?.[1] ?? '').replace(/\D/g, ''));
  return { rx: value('RX'), tx: value('TX') };
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
  const found = await devicePaths();
  const devices = found.filter((d) => d.role === 'testdevice');
  expect(devices.length, 'at least one test device').toBeGreaterThan(0);
  const [main, ...others] = devices;
  // The bridge target: a loopback adapter that passed the probe (simulator: sim:loopback).
  const adapter = useDevices
    ? found.find((d) => d.role === 'loopback')
    : { name: 'sim-loopback', path: 'sim:loopback', role: 'loopback' };
  if (adapter && useDevices)
    expect(await probeLoopback(adapter.path), `${adapter.name}: probe came back`).toBe(true);
  const streams = others.slice(0, adapter ? 3 : 4);
  // The slot devices cannot be commanded through multi-port: let them stream by themselves.
  for (const d of streams) expect(await command(d.path, 'AUTO 100')).toBe('OK AUTO 100');
  // Simulator: the sensor simulator (9600 baud) is the bridge source.
  const slots = [
    ...(useDevices ? streams : [{ name: 'sim-sensor', path: 'sim:sensor', role: 'stream' }]).map(
      (d) => ({ ...d, baud: d.path === 'sim:sensor' ? 9600 : 115200 }),
    ),
    ...(adapter ? [{ ...adapter, baud: 115200 }] : []),
  ];
  const bridgeTo = adapter ? slots.length - 1 : -1;
  const bridgeFrom = adapter && slots.length > 1 ? 0 : -1;

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
  const samples: string[] = [
    'minute;main_mb;renderer_mb;gpu_mb;js_heap_mb;dom_nodes;nodes_by_page;tab_ms;tx;rx;bridged',
  ];
  // JS heap of the renderer and, with SMP_SOAK_PROFILE=1, a CPU profile of minute 2–3.
  const cdp = await page.context().newCDPSession(page);
  const profiling = Boolean(process.env.SMP_SOAK_PROFILE);
  let profileTop: string[] = [];
  let bridgeStartRx = 0;
  let bridgeResult = 'not used (no loopback adapter)';
  const bridgeErrors: string[] = [];
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
      await page.getByTestId(`slot-${i}`).locator('input').fill(String(d.baud));
      await page.getByTestId(`slot-${i}`).locator('input').press('Tab');
      await page.getByTestId(`slot-toggle-${i}`).click();
      await expect(page.getByTestId(`slot-state-${i}`)).toContainText('connected');
    }
    if (bridgeFrom >= 0) {
      await page.getByTestId('bridge-from').selectOption(String(bridgeFrom));
      await page.getByTestId('bridge-to').selectOption(String(bridgeTo));
      await page.getByTestId('multiport-view-separate').click();
      bridgeStartRx = counterValues(
        await page.getByTestId(`slot-counters-${bridgeFrom}`).innerText(),
      ).rx;
      await page.getByTestId('bridge-on').check();
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
        // Where the nodes are: per tab page, e.g. "monitor:20412 multiport:30102".
        const byPage = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-testid^="page-"]')]
            .map((p) => `${p.dataset.testid?.slice(5)}:${p.getElementsByTagName('*').length}`)
            .join(' '),
        );
        const heap = ((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(1);
        if (profiling && minute === 2) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.start');
        }
        if (profiling && minute === 3) {
          const { profile } = await cdp.send('Profiler.stop');
          writeFileSync(join(root, 'soak-reports', 'renderer.cpuprofile'), JSON.stringify(profile));
          const self = new Map<string, number>();
          const dt = profile.timeDeltas ?? [];
          const byId = new Map(profile.nodes.map((n) => [n.id, n]));
          (profile.samples ?? []).forEach((id, i) => {
            const f = byId.get(id)?.callFrame;
            const key = f
              ? `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`
              : '?';
            self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
          });
          profileTop = [...self.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25)
            .map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`);
          writeFileSync(join(root, 'soak-reports', 'renderer-profile.txt'), profileTop.join('\n'));
          console.info(profileTop.join('\n'));
        }
        const counters = (await page.getByTestId('counters').innerText()).replace(/\s+/g, ' ');
        const tx = /TX ([\d,.]+)/.exec(counters)?.[1] ?? '';
        const rx = /RX ([\d,.]+)/.exec(counters)?.[1] ?? '';
        const bridged =
          bridgeFrom >= 0
            ? ((await page.getByTestId('bridge-bytes').textContent()) ?? '').replace(/\D/g, '')
            : '';
        samples.push(
          `${minute};${mbOf('Browser')};${mbOf('Tab')};${mbOf('GPU')};${heap};${nodes};${byPage};${tabMs};${tx};${rx};${bridged}`,
        );
        console.info(samples[samples.length - 1]);
        minute++;
      }
    }

    // Bridge: stop the source, let the last bytes come back, then compare.
    if (bridgeFrom >= 0) {
      await switchTab(page, 'multiport');
      await page.getByTestId(`slot-toggle-${bridgeFrom}`).click();
      await expect(page.getByTestId(`slot-state-${bridgeFrom}`)).not.toHaveAttribute(
        'data-state',
        'connected',
      );
      await page.waitForTimeout(2000);
      const source = counterValues(
        await page.getByTestId(`slot-counters-${bridgeFrom}`).innerText(),
      );
      const loop = counterValues(await page.getByTestId(`slot-counters-${bridgeTo}`).innerText());
      const bridged = Number(
        ((await page.getByTestId('bridge-bytes').textContent()) ?? '').replace(/\D/g, ''),
      );
      const lines = (i: number) =>
        page
          .getByTestId(`multiport-output-${i}`)
          .locator('.ln-text')
          .evaluateAll((els) =>
            els.slice(-80).map((e) => (e.textContent ?? '').replace(/^\[[^\]]*\] /, '')),
          );
      const sourceLines = await lines(bridgeFrom);
      const echoed = (await lines(bridgeTo)).slice(-30);
      const joined = sourceLines.join('\n');
      if (bridged === 0) bridgeErrors.push('nothing was forwarded');
      if (loop.tx !== bridged) bridgeErrors.push(`adapter TX ${loop.tx} ≠ forwarded ${bridged}`);
      if (loop.rx !== loop.tx) bridgeErrors.push(`adapter RX ${loop.rx} ≠ TX ${loop.tx}`);
      if (Math.abs(source.rx - bridgeStartRx - bridged) > 2000)
        bridgeErrors.push(`source received ${source.rx - bridgeStartRx}, forwarded ${bridged}`);
      if (echoed.length < 10 || !joined.includes(echoed.join('\n')))
        bridgeErrors.push('the last lines that came back differ from the source');
      bridgeResult = `${adapter!.name}: ${bridged} bytes forwarded, ${loop.rx} came back${
        bridgeErrors.length ? ` – ${bridgeErrors.join('; ')}` : ', identical'
      }`;
    }

    // Stop sending, then compare the device's own counters with what was sent.
    await switchTab(page, 'monitor');
    const sentFor = Date.now() - periodicStart;
    await expect(page.getByTestId('periodic-toggle')).toHaveText('Stop');
    await page.getByTestId('periodic-toggle').click();
    await page.getByTestId('quick-list').getByText('Streams off').click();
    await page.waitForTimeout(500);
    // The scheduler also asks for STAT?: wait for the answer to this request and
    // read the text itself (rows out of view are not rendered).
    const statLines = page.getByTestId('monitor-output').getByText(/^STAT uptime=/);
    const before = await statLines.count();
    await page.getByTestId('quick-list').getByText('Statistics').click();
    await expect.poll(() => statLines.count()).toBeGreaterThan(before);
    const statText = ((await statLines.last().textContent()) ?? '').trim();
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
      `Multi-port bridge: ${bridgeResult}`,
      `Console errors: ${errors.length}`,
      '',
      '```',
      ...samples,
      '```',
      '',
      ...errors.slice(0, 20).map((e) => `- ${e}`),
      ...(profileTop.length
        ? ['', 'CPU time of the renderer, minute 2–3 (self time):', '```', ...profileTop, '```']
        : []),
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
    expect(bridgeErrors, 'multi-port bridge to the loopback adapter').toEqual([]);
    expect(errors, 'console errors').toEqual([]);
  } finally {
    await app.close();
    // Only the test devices: nothing but the probe and the bridge ever goes to the adapter.
    for (const d of streams)
      if (existsSync(d.path) || d.path.startsWith('sim:'))
        await command(d.path, 'AUTO 0').catch(() => '');
  }
});
