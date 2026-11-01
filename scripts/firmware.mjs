#!/usr/bin/env node
// Long-run test boards: detect, compile and flash the SMP test firmware.
//
//   npm run firmware -- detect            list ports, mark approved / blocked devices
//   npm run firmware -- init              write hardware/devices.local.json from what is connected
//   npm run firmware -- compile           compile hardware/smp-testdevice for every board
//   npm run firmware -- flash <name|all>  compile and upload to approved test devices
//   npm run firmware -- check <name|all>  open each device and ask ID? (no flashing)
//
// Only devices listed in hardware/devices.local.json (matched by USB serial
// number) are ever opened or flashed. Serial numbers on the "never" list are
// refused even if listed. The file stays on this computer (.gitignore).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialPort } from 'serialport';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sketch = join(root, 'hardware', 'smp-testdevice');
const configFile = join(root, 'hardware', 'devices.local.json');

/** USB IDs of the supported boards. Generic USB-UART chips need a manual decision. */
const KNOWN = {
  '2341:0043': { board: 'uno', fqbn: 'arduino:avr:uno', label: 'Arduino Uno R3' },
  '2341:0001': { board: 'uno', fqbn: 'arduino:avr:uno', label: 'Arduino Uno' },
  '2341:0042': {
    board: 'mega2560',
    fqbn: 'arduino:avr:mega:cpu=atmega2560',
    label: 'Arduino Mega 2560 R3',
  },
  '2341:0010': {
    board: 'mega2560',
    fqbn: 'arduino:avr:mega:cpu=atmega2560',
    label: 'Arduino Mega 2560',
  },
  '2341:0070': {
    board: 'nano-esp32',
    fqbn: 'esp32:esp32:nano_nora',
    label: 'Arduino Nano ESP32',
  },
};
const GENERIC = {
  '10c4:ea60': 'Silicon Labs CP210x (e.g. ESP32-WROOM boards)',
  '1a86:7523': 'WCH CH340 (e.g. ESP32 boards, adapters)',
  '1a86:55d4': 'WCH CH9102 (e.g. ESP32 boards)',
  '0403:6001': 'FTDI FT232 (adapters and measuring devices!)',
  '0403:6015': 'FTDI FT231X (adapters and measuring devices!)',
  '067b:2303': 'Prolific PL2303 (adapters)',
};

const id = (p) => (p.vendorId ? `${p.vendorId}:${p.productId}`.toLowerCase() : '');

/** Serial number, and vendor/product ID and path when given in the entry. */
function sameDevice(device, p) {
  if (device.path) return p.path === device.path;
  if (!device.serialNumber || p.serialNumber !== device.serialNumber) return false;
  if (device.vendorId && p.vendorId?.toLowerCase() !== device.vendorId.toLowerCase()) return false;
  if (device.productId && p.productId?.toLowerCase() !== device.productId.toLowerCase())
    return false;
  return true;
}

function loadConfig() {
  if (!existsSync(configFile)) return { devices: [], never: [] };
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  return { devices: config.devices ?? [], never: config.never ?? [] };
}

async function ports() {
  return SerialPort.list();
}

/** Approved device → current port (by serial number), refusing blocked ones. */
async function resolve(config, name) {
  const list = await ports();
  const wanted = name === 'all' ? config.devices : config.devices.filter((d) => d.name === name);
  if (!wanted.length) throw new Error(`no device "${name}" in ${configFile}`);
  return wanted.map((device) => {
    if (config.never.includes(device.serialNumber))
      throw new Error(
        `${device.name}: serial number ${device.serialNumber} is on the "never" list`,
      );
    const matches = list.filter((p) => sameDevice(device, p));
    // Generic USB-UART chips share serial numbers ("0001"): never guess.
    if (matches.length > 1)
      throw new Error(
        `${device.name}: ${matches.length} ports match – add "path" to its entry in ${configFile}`,
      );
    return { device, port: matches[0] };
  });
}

function compile(fqbn) {
  const out = join(root, 'out', 'firmware', fqbn.replace(/[:=]/g, '_'));
  const r = spawnSync('arduino-cli', ['compile', '--fqbn', fqbn, '--output-dir', out, sketch], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`compile failed for ${fqbn}`);
  return out;
}

async function detect() {
  const config = loadConfig();
  for (const p of await ports()) {
    const usb = id(p);
    const approved = config.devices.find((d) => sameDevice(d, p));
    const blocked = p.serialNumber && config.never.includes(p.serialNumber);
    const kind = KNOWN[usb]?.label ?? GENERIC[usb] ?? (usb ? 'unknown USB device' : 'system port');
    const mark = blocked ? 'BLOCKED ' : approved ? `approved:${approved.name}` : '-';
    console.log(
      `${p.path.padEnd(34)} ${usb.padEnd(10)} ${(p.serialNumber ?? '').padEnd(24)} ${mark.padEnd(20)} ${kind}`,
    );
  }
}

/** Writes a starting point for devices.local.json – Arduino boards only; adapters by hand. */
async function init() {
  const config = loadConfig();
  for (const p of await ports()) {
    const known = KNOWN[id(p)];
    if (!known || !p.serialNumber) continue;
    if (config.devices.some((d) => d.serialNumber === p.serialNumber)) continue;
    config.devices.push({
      name: known.board,
      role: 'testdevice',
      serialNumber: p.serialNumber,
      fqbn: known.fqbn,
      baudRate: 115200,
    });
  }
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(
    `Wrote ${configFile}. Add ESP32-WROOM and adapter entries by hand (see hardware/README.md).`,
  );
}

async function flash(name) {
  const config = loadConfig();
  for (const { device, port } of await resolve(config, name)) {
    if (device.role !== 'testdevice') continue;
    if (!port) {
      console.log(`✗ ${device.name}: not connected (serial ${device.serialNumber})`);
      continue;
    }
    console.log(`\n▶ ${device.name} on ${port.path} (${device.fqbn})`);
    const out = compile(device.fqbn);
    const r = spawnSync(
      'arduino-cli',
      ['upload', '--fqbn', device.fqbn, '--port', port.path, '--input-dir', out],
      { stdio: 'inherit' },
    );
    console.log(r.status === 0 ? `✓ ${device.name} flashed` : `✗ ${device.name}: upload failed`);
  }
}

/** Opens each approved device and asks ID? – proves firmware and wiring. */
async function check(name) {
  const config = loadConfig();
  for (const { device, port } of await resolve(config, name)) {
    if (!port) {
      console.log(`✗ ${device.name}: not connected`);
      continue;
    }
    const sp = new SerialPort({
      path: port.path,
      baudRate: device.baudRate ?? 115200,
      autoOpen: false,
    });
    await new Promise((res, rej) => sp.open((e) => (e ? rej(e) : res())));
    let text = '';
    sp.on('data', (d) => {
      text += d.toString('latin1');
    });
    // AVR boards reset when the port opens; wait for READY (or the boot to finish).
    const deadline = Date.now() + (device.role === 'loopback' ? 0 : 4000);
    while (Date.now() < deadline && !text.includes('READY'))
      await new Promise((r) => setTimeout(r, 50));
    const probe = device.role === 'loopback' ? 'LOOPBACK-PROBE\n' : 'ID?\n';
    text = '';
    sp.write(probe);
    const until = Date.now() + 1500;
    while (Date.now() < until && !text.includes('\n')) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => sp.close(() => r()));
    const answer = text.trim().split('\n')[0] ?? '';
    const ok =
      device.role === 'loopback' ? answer === probe.trim() : answer.startsWith('ID SMP-TD/1');
    console.log(
      `${ok ? '✓' : '✗'} ${device.name.padEnd(12)} ${port.path.padEnd(32)} ${answer || '(no answer)'}`,
    );
  }
}

const [cmd = 'detect', arg = 'all'] = process.argv.slice(2);
try {
  if (cmd === 'detect') await detect();
  else if (cmd === 'init') await init();
  else if (cmd === 'compile')
    for (const fqbn of new Set(
      Object.values(KNOWN)
        .map((k) => k.fqbn)
        .concat('esp32:esp32:esp32'),
    ))
      compile(fqbn);
  else if (cmd === 'flash') await flash(arg);
  else if (cmd === 'check') await check(arg);
  else throw new Error(`unknown command ${cmd}`);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
