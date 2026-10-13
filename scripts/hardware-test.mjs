#!/usr/bin/env node
// Live test against real hardware.
//
//   npm run test:hardware -- --list
//   npm run test:hardware -- --port /dev/ttyUSB0 [--baud 115200]
//   npm run test:hardware -- --port COM3 --baud 9600
//
// Connect TX and RX of the adapter (loopback jumper) – or use a device that
// echoes everything it receives. The test sends patterns of different sizes
// including every byte value 0x00…0xFF and verifies that they come back
// unchanged. It also reports round-trip latency and throughput.

import { SerialPort } from 'serialport';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

async function list() {
  let ports;
  try {
    ports = await SerialPort.list();
  } catch (err) {
    console.log(`Port listing failed (${err.message}).`);
    if (process.platform === 'linux')
      console.log('Check /dev/ttyUSB*, /dev/ttyACM* or /dev/serial/by-id/ manually.');
    return;
  }
  if (!ports.length) {
    console.log('No serial ports found.');
    return;
  }
  for (const p of ports) {
    console.log(
      `${p.path.padEnd(24)} ${[p.manufacturer, p.vendorId && `${p.vendorId}:${p.productId}`].filter(Boolean).join(' · ')}`,
    );
  }
}

if (argv.includes('--list') || !option('port')) {
  if (!option('port'))
    console.log('Usage: npm run test:hardware -- --port <path> [--baud 115200]\n');
  await list();
  process.exit(0);
}

const path = option('port');
const baudRate = Number(option('baud', '115200'));
const port = new SerialPort({ path, baudRate, autoOpen: false });

const open = () =>
  new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
const close = () => new Promise((resolve) => port.close(() => resolve()));
let received = Buffer.alloc(0);
port.on('data', (chunk) => {
  received = Buffer.concat([received, chunk]);
});

async function roundTrip(payload, timeoutMs) {
  received = Buffer.alloc(0);
  const start = performance.now();
  await new Promise((resolve, reject) =>
    port.write(payload, (err) => (err ? reject(err) : resolve())),
  );
  await new Promise((resolve) => port.drain(() => resolve()));
  while (received.length < payload.length && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2));
  }
  return { ok: received.equals(payload), ms: performance.now() - start, got: received.length };
}

const patterns = [
  ['1 byte', Buffer.from([0x55])],
  ['ASCII line', Buffer.from('Serial Monitor Pro hardware test\r\n')],
  ['all byte values', Buffer.from(Array.from({ length: 256 }, (_, i) => i))],
  [
    '4 KiB random',
    Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))),
  ],
];

try {
  await open();
} catch (err) {
  console.error(`Cannot open ${path}: ${err.message}`);
  if (/permission/i.test(err.message) && process.platform === 'linux') {
    console.error('Hint: sudo usermod -aG dialout $USER (Arch: uucp), then log in again.');
  }
  process.exit(2);
}

console.log(`Testing ${path} at ${baudRate} baud (8N1) – TX must be connected to RX.\n`);
// Bytes per second on the wire: 10 bits per byte (start + 8 data + stop).
const wire = baudRate / 10;
let failures = 0;
for (const [name, payload] of patterns) {
  const timeout = 1000 + (payload.length / wire) * 1000 * 3;
  const r = await roundTrip(payload, timeout);
  const rate = (payload.length / (r.ms / 1000) / 1024).toFixed(1);
  console.log(
    `${r.ok ? '✓' : '✗'} ${name.padEnd(16)} ${String(payload.length).padStart(5)} B  ` +
      `${r.ms.toFixed(1).padStart(8)} ms  ${rate.padStart(7)} KiB/s` +
      (r.ok
        ? ''
        : `   (received ${r.got} B${r.got ? ', content differs' : ' – is TX connected to RX?'})`),
  );
  if (!r.ok) failures++;
}
await close();
console.log(failures ? `\n${failures} pattern(s) failed.` : '\nAll patterns came back unchanged.');
process.exit(failures ? 1 : 0);
