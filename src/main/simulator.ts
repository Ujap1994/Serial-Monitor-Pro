// Simulated test devices.
//
// They behave like real serial devices and make it possible to try every
// function without hardware – and they drive the automated end-to-end tests.
// Enable them in the settings or start the app with --simulator.

import { t } from '@shared/i18n';
import type { PortInfo } from '@shared/ipc';
import { readUInt, writeUInt, encodeUtf8, decodeLatin1 } from '@shared/core/bytes';
import { calculateCrc } from '@shared/core/crc';
import { buildModbusFrame } from '@shared/core/modbus';
import { withNmeaChecksum } from '@shared/core/nmea';

export const SIM_PREFIX = 'sim:';

const DEVICES = ['loopback', 'sensor', 'modbus', 'gps', 'frames'] as const;
type DeviceKind = (typeof DEVICES)[number];

/** Baud rate at which the sensor simulator produces readable text. */
export const SENSOR_BAUD = 9600;

export function isSimulatedPath(path: string): boolean {
  return path.startsWith(SIM_PREFIX);
}

export function simulatedPorts(): PortInfo[] {
  return DEVICES.map((kind) => ({
    path: `${SIM_PREFIX}${kind}`,
    description: t(`sim.${kind}`),
    manufacturer: 'Serial Monitor Pro',
    simulated: true,
  }));
}

export interface SimCallbacks {
  onData(data: Uint8Array): void;
}

/** Deterministic pseudo random numbers – keeps screenshots and tests reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export class SimulatedDevice {
  private timers: ReturnType<typeof setInterval>[] = [];
  private timeouts = new Set<ReturnType<typeof setTimeout>>();
  private input = '';
  private modbusBuffer: number[] = [];
  private modbusTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly registers = new Uint16Array(100);
  private readonly random = rng(0x5eed);
  private tick = 0;
  private closed = false;
  readonly kind: DeviceKind;

  constructor(
    path: string,
    private readonly baudRate: number,
    private readonly cb: SimCallbacks,
  ) {
    const kind = path.slice(SIM_PREFIX.length);
    if (!(DEVICES as readonly string[]).includes(kind)) {
      throw new Error(`No such file or directory, cannot open ${path}`);
    }
    this.kind = kind as DeviceKind;
    this.start();
  }

  private every(ms: number, fn: () => void): void {
    this.timers.push(setInterval(fn, ms));
  }

  private later(ms: number, fn: () => void): void {
    const handle = setTimeout(() => {
      this.timeouts.delete(handle);
      if (!this.closed) fn();
    }, ms);
    this.timeouts.add(handle);
  }

  private emit(data: Uint8Array | string): void {
    if (this.closed) return;
    this.cb.onData(typeof data === 'string' ? encodeUtf8(data) : data);
  }

  private start(): void {
    switch (this.kind) {
      case 'sensor':
        this.every(250, () => this.sensorTick());
        break;
      case 'gps':
        this.every(1000, () => this.gpsTick());
        this.later(150, () => this.gpsTick());
        break;
      case 'frames':
        this.every(400, () => this.frameTick());
        break;
      case 'modbus':
        for (let i = 0; i < this.registers.length; i++) this.registers[i] = i * 10;
        this.every(1000, () => {
          this.registers[0] = ((this.registers[0] ?? 0) + 1) & 0xffff;
        });
        break;
      case 'loopback':
        break;
    }
  }

  /** Garbage that a receiver sees at a wrong baud rate (framing errors). */
  private noise(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = 0x80 + Math.floor(this.random() * 0x7f);
    return out;
  }

  private sensorTick(): void {
    this.tick++;
    const x = this.tick / 8;
    const temp = 23.5 + 1.8 * Math.sin(x) + (this.random() - 0.5) * 0.2;
    const humidity = 45 + 6 * Math.cos(x / 1.7) + (this.random() - 0.5) * 0.4;
    const pressure = 1013.2 + 2.5 * Math.sin(x / 3.1);
    const line =
      `Temp:${temp.toFixed(2)}, Humidity:${humidity.toFixed(1)}, ` +
      `Pressure:${pressure.toFixed(1)}\r\n`;
    this.emit(this.baudRate === SENSOR_BAUD ? line : this.noise(line.length));
  }

  private gpsTick(): void {
    this.tick++;
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    const time = `${hh}${mm}${ss}`;
    const lat = (4807.038 + this.tick * 0.0021).toFixed(3);
    const lon = (1131.0 + this.tick * 0.0034).toFixed(3);
    const date = `${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCFullYear() % 100).padStart(2, '0')}`;
    this.emit(
      `${withNmeaChecksum(`GPGGA,${time},${lat},N,0${lon},E,1,08,0.9,545.4,M,46.9,M,,`)}\r\n` +
        `${withNmeaChecksum(`GPRMC,${time},A,${lat},N,0${lon},E,022.4,084.4,${date},003.1,W`)}\r\n`,
    );
  }

  private frameTick(): void {
    this.tick++;
    const payload = Uint8Array.of(this.tick & 0xff, Math.floor(this.random() * 256), 0x42);
    const body = Uint8Array.of(0xaa, 0x55, payload.length, ...payload);
    let crc = calculateCrc(body, 'CRC-8');
    if (this.tick % 7 === 0) crc ^= 0xff; // every 7th telegram is damaged
    this.emit(Uint8Array.of(...body, crc));
  }

  /** Called when the application writes to the device. */
  write(data: Uint8Array): void {
    if (this.closed) return;
    switch (this.kind) {
      case 'loopback':
        this.later(3, () => this.emit(data.slice()));
        break;
      case 'sensor':
        if (this.baudRate === SENSOR_BAUD) this.sensorCommand(data);
        break;
      case 'modbus':
        this.modbusBuffer.push(...data);
        if (this.modbusTimer) clearTimeout(this.modbusTimer);
        // RTU: a telegram ends after a pause of 3.5 characters.
        this.modbusTimer = setTimeout(() => this.modbusFrame(), 15);
        break;
      case 'gps':
      case 'frames':
        // these devices only transmit
        break;
    }
  }

  private sensorCommand(data: Uint8Array): void {
    this.input += decodeLatin1(data);
    let idx: number;
    while ((idx = this.input.search(/[\r\n]/)) >= 0) {
      const cmd = this.input.slice(0, idx).trim().toUpperCase();
      this.input = this.input.slice(idx + 1);
      if (!cmd) continue;
      const reply =
        cmd === 'AT'
          ? 'OK'
          : cmd === 'ATI'
            ? 'SMP Sensor Simulator 1.0\r\nOK'
            : cmd === 'AT+RST'
              ? 'READY'
              : 'ERROR';
      this.later(20, () => this.emit(`${reply}\r\n`));
    }
    if (this.input.length > 256) this.input = '';
  }

  private modbusFrame(): void {
    const frame = Uint8Array.from(this.modbusBuffer);
    this.modbusBuffer = [];
    if (frame.length < 4) return;
    const body = frame.subarray(0, -2);
    if (calculateCrc(body, 'CRC-16/MODBUS') !== readUInt(frame.subarray(-2), false)) return;
    if (frame[0] !== 1) return; // only slave 1 answers

    const func = frame[1] ?? 0;
    const exception = (code: number): void =>
      this.later(10, () => this.emit(buildModbusFrame(Uint8Array.of(1, func | 0x80, code))));

    if ((func === 3 || func === 4) && body.length === 6) {
      const address = readUInt(body.subarray(2, 4), true);
      const count = readUInt(body.subarray(4, 6), true);
      if (count < 1 || count > 60) return exception(3);
      if (address + count > this.registers.length) return exception(2);
      const values: number[] = [];
      for (let i = 0; i < count; i++)
        values.push(...writeUInt(this.registers[address + i] ?? 0, 2, true));
      this.later(10, () =>
        this.emit(buildModbusFrame(Uint8Array.of(1, func, count * 2, ...values))),
      );
      return;
    }
    if (func === 6 && body.length === 6) {
      const address = readUInt(body.subarray(2, 4), true);
      if (address >= this.registers.length) return exception(2);
      this.registers[address] = readUInt(body.subarray(4, 6), true);
      this.later(10, () => this.emit(frame.slice()));
      return;
    }
    exception(1);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    for (const handle of this.timeouts) clearTimeout(handle);
    if (this.modbusTimer) clearTimeout(this.modbusTimer);
    this.timers = [];
    this.timeouts.clear();
  }
}
