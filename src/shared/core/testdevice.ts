// SMP test device (protocol "SMP-TD/1") – the reference implementation.
//
// The same behaviour runs as firmware on the long-run test boards
// (hardware/smp-testdevice) and as the simulated device "sim:testdevice".
// Keep both in step: every change here needs the same change in the sketch.
//
// Text commands end with LF (CR is ignored). Binary frames start with AA 55:
//   AA 55 <len 0…64> <payload> <CRC-16/MODBUS over len+payload, little-endian>
//
//   PING <n>        → PONG <n>
//   ECHO <text>     → ECHO <text>
//   ID?             → ID SMP-TD/1 board=<board> fw=<version> uptime=<ms>
//   STAT?           → STAT uptime=… rxbytes=… txbytes=… lines=… frames=… crcerr=… badframes=… errors=… streamed=… faults=…
//   CLEAR           → OK CLEAR            (counters back to zero)
//   STREAM <ms>     → OK STREAM <ms>      then "Temp:…, Humidity:…, Pressure:…, Seq:<n>" every <ms> (0 = off)
//   NMEA <ms>       → OK NMEA <ms>        then $GPGGA sentences with the sequence as time (0 = off)
//   MODBUS <ms>     → OK MODBUS <ms>      then Modbus RTU responses 01 03 04 <seq> <value> CRC (0 = off)
//   FAULT <n>       → OK FAULT <n>        every n-th NMEA/Modbus item gets a wrong checksum (0 = off)
//   BURST <n>       → BURST <n>, then exactly n bytes (i & 0xFF), then "BURSTEND <crc16 hex>"
//   AUTO <ms>       → OK AUTO <ms>        stored permanently: after every start the sensor stream runs (0 = off)
//   RESET           → OK RESET            then a restart and "READY …"
//   frame           → ACK <crc hex> | NAK <expected hex> <received hex> | NAK LEN <len> | NAK TIMEOUT
//   anything else   → ERR UNKNOWN <word> | ERR LONG

import { calculateCrc } from './crc';
import { nmeaChecksum } from './nmea';

export const TD_PROTOCOL = 'SMP-TD/1';
export const TD_FIRMWARE = '1.0';
export const TD_MAX_FRAME = 64;
export const TD_MAX_LINE = 120;
export const TD_MAX_BURST = 4096;
export const TD_MIN_PERIOD = 10;
export const TD_FRAME_TIMEOUT = 1000;

export interface TestDeviceCounters {
  rxbytes: number;
  txbytes: number;
  lines: number;
  frames: number;
  crcerr: number;
  badframes: number;
  errors: number;
  streamed: number;
  faults: number;
}

export interface TestDeviceIo {
  write(data: Uint8Array): void;
  /** Permanent storage of the AUTO period (EEPROM/NVS on the boards). */
  loadAuto?(): number;
  saveAuto?(ms: number): void;
  /** Called after "OK RESET"; the device boots again (the core calls boot()). */
  restart?(): void;
}

const encoder = new TextEncoder();

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

function zero(): TestDeviceCounters {
  return {
    rxbytes: 0,
    txbytes: 0,
    lines: 0,
    frames: 0,
    crcerr: 0,
    badframes: 0,
    errors: 0,
    streamed: 0,
    faults: 0,
  };
}

/** Pseudo sensor values from the sequence number (same formula as the firmware). */
export function sensorLine(seq: number): string {
  const temp = 23.5 + 1.8 * Math.sin(seq / 8);
  const humidity = 45 + 6 * Math.cos(seq / 13.6);
  const pressure = 1013.2 + 2.5 * Math.sin(seq / 24.8);
  return `Temp:${temp.toFixed(2)}, Humidity:${humidity.toFixed(1)}, Pressure:${pressure.toFixed(1)}, Seq:${seq}`;
}

/** $GPGGA with the sequence number in the time field. */
export function nmeaLine(seq: number, fault: boolean): string {
  const body = `GPGGA,${String(seq % 1_000_000).padStart(6, '0')},4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,`;
  const cs = nmeaChecksum(body) ^ (fault ? 0xff : 0);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Modbus RTU response 01 03 04 <seq> <value>, CRC little-endian. */
export function modbusFrame(seq: number, fault: boolean): Uint8Array {
  const value = (seq * 7) & 0xffff;
  const body = [0x01, 0x03, 0x04, (seq >> 8) & 0xff, seq & 0xff, value >> 8, value & 0xff];
  const crc = calculateCrc(Uint8Array.from(body), 'CRC-16/MODBUS') ^ (fault ? 0xffff : 0);
  return Uint8Array.from([...body, crc & 0xff, crc >> 8]);
}

/** Byte i of a burst – the runner checks it the same way. */
export const burstByte = (i: number): number => i & 0xff;

export function burstCrc(length: number): number {
  return calculateCrc(
    Uint8Array.from({ length }, (_, i) => burstByte(i)),
    'CRC-16/MODBUS',
  );
}

/** Builds a test frame AA 55 len payload CRC (what the device expects). */
export function testFrame(payload: Uint8Array, corrupt = false): Uint8Array {
  const covered = Uint8Array.from([payload.length, ...payload]);
  const crc = calculateCrc(covered, 'CRC-16/MODBUS') ^ (corrupt ? 0x0001 : 0);
  return Uint8Array.from([0xaa, 0x55, ...covered, crc & 0xff, crc >> 8]);
}

interface Stream {
  period: number;
  due: number;
  seq: number;
}

export class TestDeviceCore {
  private line: number[] = [];
  private lineOverflow = false;
  private frame: number[] | null = null;
  private frameStart = 0;
  private pendingAa = false;
  private bootTime = 0;
  private counters = zero();
  private fault = 0;
  private readonly streams: Record<'sensor' | 'nmea' | 'modbus', Stream> = {
    sensor: { period: 0, due: 0, seq: 0 },
    nmea: { period: 0, due: 0, seq: 0 },
    modbus: { period: 0, due: 0, seq: 0 },
  };

  constructor(
    private readonly io: TestDeviceIo,
    private readonly now: () => number,
    readonly board = 'simulator',
  ) {}

  get stats(): Readonly<TestDeviceCounters> {
    return this.counters;
  }

  /** Power-on: everything back to the start, then the READY line. */
  boot(): void {
    this.bootTime = this.now();
    this.counters = zero();
    this.fault = 0;
    this.line = [];
    this.frame = null;
    this.pendingAa = false;
    this.lineOverflow = false;
    for (const s of Object.values(this.streams)) Object.assign(s, { period: 0, due: 0, seq: 0 });
    this.send(`READY ${TD_PROTOCOL} board=${this.board} fw=${TD_FIRMWARE}`);
    const auto = this.io.loadAuto?.() ?? 0;
    if (auto > 0) {
      this.streams.sensor.period = Math.max(TD_MIN_PERIOD, auto);
      this.streams.sensor.due = this.now() + this.streams.sensor.period;
    }
  }

  private uptime(): number {
    return Math.max(0, Math.round(this.now() - this.bootTime));
  }

  private raw(data: Uint8Array): void {
    this.counters.txbytes += data.length;
    this.io.write(data);
  }

  private send(text: string): void {
    this.raw(encoder.encode(`${text}\n`));
  }

  input(data: Uint8Array): void {
    for (const byte of data) this.byte(byte);
  }

  private byte(b: number): void {
    this.counters.rxbytes++;
    if (this.frame) {
      this.frame.push(b);
      const len = this.frame[0] ?? 0;
      if (this.frame.length === 1 && len > TD_MAX_FRAME) {
        this.counters.badframes++;
        this.send(`NAK LEN ${len}`);
        this.frame = null;
      } else if (this.frame.length === len + 3) {
        this.finishFrame(this.frame);
        this.frame = null;
      }
      return;
    }
    if (this.pendingAa) {
      this.pendingAa = false;
      if (b === 0x55) {
        this.frame = [];
        this.frameStart = this.now();
        return;
      }
      this.counters.errors++;
    }
    if (b === 0xaa && this.line.length === 0) {
      this.pendingAa = true;
      return;
    }
    if (b === 0x0d) return;
    if (b === 0x0a) {
      if (this.lineOverflow) {
        this.counters.errors++;
        this.send('ERR LONG');
      } else {
        this.command(this.line);
      }
      this.line = [];
      this.lineOverflow = false;
      return;
    }
    if (this.line.length >= TD_MAX_LINE) this.lineOverflow = true;
    else this.line.push(b);
  }

  private finishFrame(frame: number[]): void {
    const len = frame[0] ?? 0;
    const covered = Uint8Array.from(frame.slice(0, len + 1));
    const expected = calculateCrc(covered, 'CRC-16/MODBUS');
    const received = (frame[len + 1] ?? 0) | ((frame[len + 2] ?? 0) << 8);
    if (expected === received) {
      this.counters.frames++;
      this.send(`ACK ${hex4(expected)}`);
    } else {
      this.counters.crcerr++;
      this.send(`NAK ${hex4(expected)} ${hex4(received)}`);
    }
  }

  private setStream(kind: keyof TestDeviceCore['streams'], arg: string, word: string): void {
    const ms = Number.parseInt(arg, 10);
    if (!Number.isFinite(ms) || ms < 0) {
      this.counters.errors++;
      this.send(`ERR ARG ${word}`);
      return;
    }
    const period = ms === 0 ? 0 : Math.max(TD_MIN_PERIOD, ms);
    const stream = this.streams[kind];
    stream.period = period;
    stream.due = this.now() + period;
    this.send(`OK ${word} ${period}`);
  }

  private command(bytes: readonly number[]): void {
    this.counters.lines++;
    // Command words are ASCII; ECHO returns its argument byte for byte.
    const space = bytes.indexOf(0x20);
    const word = String.fromCharCode(...(space < 0 ? bytes : bytes.slice(0, space)))
      .trim()
      .toUpperCase();
    if (!word) return;
    const argBytes = space < 0 ? [] : bytes.slice(space + 1);
    const arg = String.fromCharCode(...argBytes).trim();
    switch (word) {
      case 'PING':
        this.send(`PONG ${arg}`);
        return;
      case 'ECHO':
        this.raw(Uint8Array.from([...encoder.encode('ECHO '), ...argBytes, 0x0a]));
        return;
      case 'ID?':
        this.send(
          `ID ${TD_PROTOCOL} board=${this.board} fw=${TD_FIRMWARE} uptime=${this.uptime()}`,
        );
        return;
      case 'STAT?': {
        const c = this.counters;
        this.send(
          `STAT uptime=${this.uptime()} rxbytes=${c.rxbytes} txbytes=${c.txbytes} lines=${c.lines} ` +
            `frames=${c.frames} crcerr=${c.crcerr} badframes=${c.badframes} errors=${c.errors} ` +
            `streamed=${c.streamed} faults=${c.faults}`,
        );
        return;
      }
      case 'CLEAR':
        this.counters = zero();
        this.send('OK CLEAR');
        return;
      case 'STREAM':
        this.setStream('sensor', arg, word);
        return;
      case 'NMEA':
        this.setStream('nmea', arg, word);
        return;
      case 'MODBUS':
        this.setStream('modbus', arg, word);
        return;
      case 'FAULT': {
        const n = Number.parseInt(arg, 10);
        this.fault = Number.isFinite(n) && n > 0 ? n : 0;
        this.send(`OK FAULT ${this.fault}`);
        return;
      }
      case 'BURST': {
        const n = Number.parseInt(arg, 10);
        if (!Number.isFinite(n) || n < 1 || n > TD_MAX_BURST) {
          this.counters.errors++;
          this.send(`ERR ARG ${word}`);
          return;
        }
        this.send(`BURST ${n}`);
        this.raw(Uint8Array.from({ length: n }, (_, i) => burstByte(i)));
        this.send(`BURSTEND ${hex4(burstCrc(n))}`);
        return;
      }
      case 'AUTO': {
        const n = Number.parseInt(arg, 10);
        const ms = Number.isFinite(n) && n > 0 ? Math.min(60_000, Math.max(TD_MIN_PERIOD, n)) : 0;
        this.io.saveAuto?.(ms);
        this.send(`OK AUTO ${ms}`);
        return;
      }
      case 'RESET':
        this.send('OK RESET');
        this.io.restart?.();
        this.boot();
        return;
      default:
        this.counters.errors++;
        this.send(`ERR UNKNOWN ${word}`);
    }
  }

  /** Runs due stream items and frame timeouts; call it every few milliseconds. */
  tick(): void {
    const now = this.now();
    if (this.frame && now - this.frameStart > TD_FRAME_TIMEOUT) {
      this.frame = null;
      this.counters.badframes++;
      this.send('NAK TIMEOUT');
    }
    for (const [kind, s] of Object.entries(this.streams) as [
      keyof TestDeviceCore['streams'],
      Stream,
    ][]) {
      if (!s.period || now < s.due) continue;
      // Far behind (e.g. the computer slept): continue from now instead of a burst.
      s.due = now - s.due > 10 * s.period ? now + s.period : s.due + s.period;
      s.seq++;
      this.counters.streamed++;
      const fault = this.fault > 0 && s.seq % this.fault === 0;
      if (fault && kind !== 'sensor') this.counters.faults++;
      if (kind === 'sensor') this.send(sensorLine(s.seq));
      else if (kind === 'nmea') this.send(nmeaLine(s.seq, fault));
      else this.raw(modbusFrame(s.seq, fault));
    }
  }
}
