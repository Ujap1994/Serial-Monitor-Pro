// Records real device sessions as replay fixtures (tests/fixtures/captures/).
//
//   SMP_RECORD_FIXTURES=1 npm run soak -- record-fixtures
//
// Every approved device of hardware/devices.local.json gets a short, fixed
// script through the application's own SerialManager and session capture. The
// files are anonymised (no port names) and replayed in every CI build by
// tests/unit/capture-fixtures.test.ts. Nothing runs without SMP_RECORD_FIXTURES.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SerialPort } from 'serialport';
import { expect, it } from 'vitest';
import { concatBytes, decodeLatin1, encodeUtf8 } from '@shared/core/bytes';
import { anonymizeCapture, encodeCapture, parseCapture } from '@shared/core/capture';
import { testFrame } from '@shared/core/testdevice';
import type { SerialEvent } from '@shared/ipc';
import { CaptureWriter } from '../../src/main/capture';
import { SerialManager } from '../../src/main/serial';
import type { LaneConfig } from './runner';

const root = join(import.meta.dirname, '..', '..');
const out = join(root, 'tests', 'fixtures', 'captures');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Device = LaneConfig & { fqbn?: string };

async function locate(d: Device): Promise<string | null> {
  const matches = (await SerialPort.list()).filter(
    (p) =>
      p.serialNumber === d.serialNumber &&
      (!d.vendorId || p.vendorId?.toLowerCase() === d.vendorId.toLowerCase()) &&
      (!d.productId || p.productId?.toLowerCase() === d.productId.toLowerCase()),
  );
  return d.path ?? (matches.length === 1 ? matches[0]!.path : null);
}

async function record(device: Device, path: string): Promise<string> {
  const received: Uint8Array[] = [];
  const manager = new SerialManager((e: SerialEvent) => {
    if (e.kind === 'data') for (const c of e.chunks) received.push(c.data);
  });
  const text = () => decodeLatin1(concatBytes(...received));
  const file = join(out, `${device.name}.smpcap`);
  const opened = await manager.open('rec', {
    path,
    baudRate: device.baudRate ?? 115200,
    dataBits: 8,
    parity: 'None',
    stopBits: '1',
  });
  if (!opened.ok) throw new Error(`${device.name}: ${opened.error}`);
  const writer = new CaptureWriter(
    file,
    process.env.npm_package_version ?? '',
    manager.optionsOf('rec'),
  );
  manager.setTap('rec', (e) => writer.record(e));
  /** Sends and waits until `done` holds for what came back since. */
  const ask = async (data: string | Uint8Array, done: (t: string) => boolean, ms = 3000) => {
    received.length = 0;
    await manager.write('rec', typeof data === 'string' ? encodeUtf8(data) : data);
    const deadline = Date.now() + ms;
    while (!done(text()) && Date.now() < deadline) await sleep(5);
    await sleep(40);
    if (!done(text())) throw new Error(`${device.name}: no answer to ${JSON.stringify(data)}`);
    return text();
  };
  const line = (prefix: string) => (t: string) =>
    t.split('\n').some((l, i, all) => l.startsWith(prefix) && i < all.length - 1);

  try {
    if (device.role === 'loopback') {
      const all = Uint8Array.from({ length: 256 }, (_, i) => i);
      for (const block of [encodeUtf8('SMP loopback probe\r\n'), all, all.slice(0, 64)])
        await ask(block, (t) => t.length >= block.length);
    } else {
      // Uno and Mega restart when the port opens; the ESP32-WROOM is restarted on purpose
      // to keep its boot messages (74880 baud) in the capture.
      await sleep(3500);
      if (device.name === 'esp32-wroom') await ask('RESET\n', line('READY'), 6000);
      await ask('ID?\n', line('ID SMP-TD/1'));
      await ask('CLEAR\n', line('OK CLEAR'));
      await ask('PING 42\n', line('PONG 42'));
      await ask('ECHO Hello capture – äöü\n', line('ECHO'));
      await ask(testFrame(encodeUtf8('payload'), false), line('ACK'));
      await ask(testFrame(encodeUtf8('payload'), true), line('NAK'));
      await ask('STREAM 100\n', line('OK STREAM'));
      await sleep(1500);
      await ask('STREAM 0\n', line('OK STREAM 0'));
      await ask('FAULT 3\n', line('OK FAULT'));
      await ask('NMEA 100\n', line('OK NMEA'));
      await sleep(1500);
      await ask('NMEA 0\n', line('OK NMEA 0'));
      await ask('FAULT 0\n', line('OK FAULT 0'));
      await ask('MODBUS 100\n', line('OK MODBUS'));
      await sleep(1000);
      await ask('MODBUS 0\n', line('OK MODBUS 0'));
      // The burst bytes contain line feeds: look for the end line anywhere.
      await ask('BURST 512\n', (t) => /BURSTEND [0-9A-F]{4}\n/.test(t));
      await ask('STAT?\n', line('STAT '));
      await ask('NOPE\n', line('ERR UNKNOWN'));
    }
  } finally {
    await manager.closeAll();
    manager.setTap('rec', null);
    await writer.finish();
  }
  // No port names in the repository.
  const capture = anonymizeCapture(parseCapture(readFileSync(file, 'utf8')));
  writeFileSync(file, encodeCapture(capture));
  return file;
}

it.runIf(Boolean(process.env.SMP_RECORD_FIXTURES))(
  'records device sessions as fixtures',
  async () => {
    const config = join(root, 'hardware', 'devices.local.json');
    expect(existsSync(config), `${config} is missing`).toBe(true);
    const local = JSON.parse(readFileSync(config, 'utf8')) as {
      devices: Device[];
      never?: string[];
    };
    const never = new Set(local.never ?? []);
    mkdirSync(out, { recursive: true });
    for (const device of local.devices) {
      if (device.serialNumber && never.has(device.serialNumber)) continue;
      const path = await locate(device);
      if (!path) {
        console.info(`${device.name}: not connected – skipped`);
        continue;
      }
      console.info(`${device.name}: ${await record(device, path)}`);
    }
  },
);
