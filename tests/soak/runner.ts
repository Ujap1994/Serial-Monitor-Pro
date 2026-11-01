// Long-run test of the serial stack of Serial Monitor Pro against test devices.
//
// Every lane drives one device through the application's own SerialManager:
//  - "testdevice": firmware/simulator with protocol SMP-TD/1 – requests with
//    exactly known answers, CRC frames checked by the device, streams with
//    sequence numbers, bursts, device counters compared at the end.
//  - "loopback": an adapter with RX and TX bridged – every block must come
//    back byte for byte.
// Devices are found by USB serial number, so a re-plugged device that got a
// new port name is found again. Nothing is opened that is not configured.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SerialPort } from 'serialport';
import { calculateCrc } from '@shared/core/crc';
import { isNmeaValid } from '@shared/core/nmea';
import { burstByte, burstCrc, testFrame } from '@shared/core/testdevice';
import type { SerialEvent } from '@shared/ipc';
import { SerialManager } from '../../src/main/serial';

export interface LaneConfig {
  name: string;
  role: 'testdevice' | 'loopback';
  /** USB serial number (real devices), optionally narrowed by USB vendor/product ID … */
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  /** … or a fixed path (simulators, or devices without a serial number). */
  path?: string;
  baudRate?: number;
  /** Pause between two requests in ms – keeps the device load moderate. */
  gapMs?: number;
  /** Largest ECHO text / frame payload; small for boards with tiny receive buffers. */
  maxPayload?: number;
  /** Sensor and NMEA stream periods in ms (0 = off). */
  streamMs?: number;
  nmeaMs?: number;
  /** Every n-th NMEA sentence gets a wrong checksum on purpose (0 = off). */
  faultEvery?: number;
  /** Send RESET every n minutes (0 = never). */
  resetEveryMin?: number;
  /** DTR/RTS after opening; some ESP32 boards need both off. */
  dtr?: boolean;
  rts?: boolean;
}

export interface SoakConfig {
  lanes: LaneConfig[];
  /** Serial numbers that must never be opened. */
  never?: string[];
}

interface LaneStats {
  connected: boolean;
  requests: number;
  ok: number;
  timeouts: number;
  mismatches: number;
  nakExpected: number;
  nakMissing: number;
  nakUnexpected: number;
  streamLines: number;
  streamGaps: number;
  streamBad: number;
  nmeaOk: number;
  nmeaBad: number;
  bursts: number;
  burstBad: number;
  reboots: number;
  resets: number;
  reconnects: number;
  downtimeMs: number;
  unexpected: number;
  deviceMismatch: number;
  framesSent: number;
  corruptSent: number;
  latencies: number[];
  lastDeviceStat: Record<string, number> | null;
  notes: string[];
}

const newStats = (): LaneStats => ({
  connected: false,
  requests: 0,
  ok: 0,
  timeouts: 0,
  mismatches: 0,
  nakExpected: 0,
  nakMissing: 0,
  nakUnexpected: 0,
  streamLines: 0,
  streamGaps: 0,
  streamBad: 0,
  nmeaOk: 0,
  nmeaBad: 0,
  bursts: 0,
  burstBad: 0,
  reboots: 0,
  resets: 0,
  reconnects: 0,
  downtimeMs: 0,
  unexpected: 0,
  deviceMismatch: 0,
  framesSent: 0,
  corruptSent: 0,
  latencies: [],
  lastDeviceStat: null,
  notes: [],
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const encoder = new TextEncoder();

/** Deterministic pseudo random numbers – a failing run can be repeated exactly. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type Pending = {
  match: (line: string) => boolean;
  resolve: (line: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

class Lane {
  readonly stats = newStats();
  private path = '';
  private buffer: number[] = [];
  private pending: Pending | null = null;
  /** A running BURST: raw bytes first, then the BURSTEND line. */
  private burst: {
    n: number;
    got: number[];
    resolve: (result: { bytes: number[]; end: string } | null) => void;
  } | null = null;
  /** True while a device is being set up (boot noise of ESP32 boards is no error). */
  private preparing = false;
  private loopbackWait: { data: Uint8Array; got: number[]; resolve: (ok: boolean) => void } | null =
    null;
  private streamSeq = -1;
  private nmeaSeq = -1;
  private epochFrames = 0;
  private epochCorrupt = 0;
  private readyResolve: (() => void) | null = null;
  private expectingReset = false;
  private downSince = 0;
  private readonly random: () => number;

  constructor(
    readonly config: LaneConfig,
    private readonly manager: SerialManager,
    private readonly log: (lane: string, text: string) => void,
    seed: number,
  ) {
    this.random = rng(seed);
  }

  private get id(): string {
    return `soak-${this.config.name}`;
  }

  private note(text: string): void {
    this.stats.notes.push(`${new Date().toISOString()} ${text}`);
    if (this.stats.notes.length > 200) this.stats.notes.shift();
    this.log(this.config.name, text);
  }

  async locate(): Promise<string | null> {
    if (this.config.path) return this.config.path;
    const c = this.config;
    const matches = (await SerialPort.list()).filter(
      (p) =>
        p.serialNumber === c.serialNumber &&
        (!c.vendorId || p.vendorId?.toLowerCase() === c.vendorId.toLowerCase()) &&
        (!c.productId || p.productId?.toLowerCase() === c.productId.toLowerCase()),
    );
    // Generic USB-UART chips share serial numbers ("0001"): never guess.
    if (matches.length > 1) {
      this.note(`${matches.length} ports match – set "path" for this device`);
      return null;
    }
    return matches[0]?.path ?? null;
  }

  async open(): Promise<boolean> {
    const path = await this.locate();
    if (!path) return false;
    this.path = path;
    this.buffer = [];
    const result = await this.manager.open(this.id, {
      path,
      baudRate: this.config.baudRate ?? 115200,
      dataBits: 8,
      parity: 'None',
      stopBits: '1',
      lines: { dtr: this.config.dtr ?? true, rts: this.config.rts ?? true },
    });
    if (!result.ok) {
      this.note(`open ${path} failed: ${result.error}`);
      return false;
    }
    this.stats.connected = true;
    return true;
  }

  /** Data from the SerialManager. */
  onData(data: Uint8Array): void {
    for (const b of data) {
      if (this.burst && this.burst.got.length < this.burst.n) {
        this.burst.got.push(b);
        continue;
      }
      if (this.loopbackWait) {
        this.loopbackWait.got.push(b);
        if (this.loopbackWait.got.length === this.loopbackWait.data.length) {
          const done = this.loopbackWait;
          this.loopbackWait = null;
          done.resolve(done.got.every((x, i) => x === done.data[i]));
        }
        continue;
      }
      if (this.config.role === 'loopback') {
        this.stats.unexpected++;
        continue;
      }
      if (b === 0x0a) {
        const line = new TextDecoder('latin1')
          .decode(Uint8Array.from(this.buffer))
          .replace(/\r$/, '');
        this.buffer = [];
        this.line(line);
      } else if (this.buffer.length < 512) this.buffer.push(b);
    }
  }

  onClosed(lost: boolean): void {
    if (!this.stats.connected) return;
    this.stats.connected = false;
    this.downSince = Date.now();
    this.note(lost ? `connection lost on ${this.path}` : `closed ${this.path}`);
    this.pending?.resolve(null);
    this.burst?.resolve(null);
    this.loopbackWait?.resolve(false);
  }

  private line(line: string): void {
    if (this.burst && this.burst.got.length === this.burst.n && line.startsWith('BURSTEND ')) {
      const done = this.burst;
      this.burst = null;
      done.resolve({ bytes: done.got, end: line });
      return;
    }
    if (line.startsWith('READY ')) {
      if (this.expectingReset) this.stats.resets++;
      else if (this.readyResolve === null) {
        this.stats.reboots++;
        this.note(`unexpected reboot: ${line}`);
      }
      this.expectingReset = false;
      this.streamSeq = -1;
      this.nmeaSeq = -1;
      this.epochFrames = 0;
      this.epochCorrupt = 0;
      this.readyResolve?.();
      this.readyResolve = null;
      return;
    }
    if (line.startsWith('Temp:')) {
      const seq = Number(/Seq:(\d+)$/.exec(line)?.[1]);
      if (
        !Number.isFinite(seq) ||
        !/^Temp:-?[\d.]+, Humidity:-?[\d.]+, Pressure:-?[\d.]+, Seq:\d+$/.test(line)
      ) {
        this.stats.streamBad++;
        this.note(`bad stream line: ${line.slice(0, 80)}`);
        return;
      }
      if (this.streamSeq >= 0 && seq !== this.streamSeq + 1) {
        this.stats.streamGaps++;
        this.note(`stream gap: ${this.streamSeq} → ${seq}`);
      }
      this.streamSeq = seq;
      this.stats.streamLines++;
      return;
    }
    if (line.startsWith('$GPGGA,')) {
      const seq = Number(line.slice(7, 13));
      if (isNmeaValid(line)) this.stats.nmeaOk++;
      else this.stats.nmeaBad++;
      if (this.nmeaSeq >= 0 && seq !== (this.nmeaSeq + 1) % 1_000_000) {
        this.stats.streamGaps++;
        this.note(`NMEA gap: ${this.nmeaSeq} → ${seq}`);
      }
      this.nmeaSeq = seq;
      return;
    }
    if (this.pending?.match(line)) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(line);
      return;
    }
    if (this.preparing) {
      this.note(`ignored during start-up: ${JSON.stringify(line.slice(0, 60))}`);
      return;
    }
    this.stats.unexpected++;
    this.note(`unexpected line: ${line.slice(0, 80)}`);
  }

  private write(data: Uint8Array): Promise<boolean> {
    return this.manager.write(this.id, data).then((r) => r.ok);
  }

  /** Sends and waits for the first line matching `match`. */
  private async request(
    data: Uint8Array | string,
    match: (line: string) => boolean,
    timeoutMs = 1000,
  ): Promise<string | null> {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    const reply = new Promise<string | null>((resolve) => {
      this.pending = {
        match,
        resolve,
        timer: setTimeout(() => {
          this.pending = null;
          resolve(null);
        }, timeoutMs),
      };
    });
    const started = performance.now();
    this.stats.requests++;
    if (!(await this.write(bytes))) {
      this.pending?.resolve(null);
      return null;
    }
    const line = await reply;
    if (line === null) {
      if (this.stats.connected) this.stats.timeouts++;
      return null;
    }
    const ms = performance.now() - started;
    if (this.stats.latencies.length < 20_000) this.stats.latencies.push(ms);
    else this.stats.latencies[Math.floor(this.random() * 20_000)] = ms;
    return line;
  }

  /** After opening: wait for the boot message of boards that reset on open, then set up. */
  async prepare(): Promise<boolean> {
    if (this.config.role === 'loopback') return true;
    this.preparing = true;
    try {
      return await this.setup();
    } finally {
      this.preparing = false;
    }
  }

  private async setup(): Promise<boolean> {
    const ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    await Promise.race([ready, sleep(3500)]);
    this.readyResolve = null;
    if (!this.stats.connected) return false;
    const id = await this.request('ID?\n', (l) => l.startsWith('ID SMP-TD/1'), 2000);
    if (!id) {
      if (this.stats.connected) this.note('no answer to ID? – is the SMP test firmware flashed?');
      return false;
    }
    this.note(id);
    const setup = [
      'CLEAR\n',
      `STREAM ${this.config.streamMs ?? 200}\n`,
      `NMEA ${this.config.nmeaMs ?? 1000}\n`,
      `FAULT ${this.config.faultEvery ?? 0}\n`,
    ];
    for (const cmd of setup) {
      const word = cmd.split(' ')[0]!.trim();
      if (!(await this.request(cmd, (l) => l.startsWith(`OK ${word}`)))) return false;
    }
    this.streamSeq = -1;
    this.nmeaSeq = -1;
    this.epochFrames = 0;
    this.epochCorrupt = 0;
    return true;
  }

  private payload(max: number): Uint8Array {
    const n = 1 + Math.floor(this.random() * max);
    return Uint8Array.from({ length: n }, () => Math.floor(this.random() * 256));
  }

  private text(max: number): string {
    const n = 1 + Math.floor(this.random() * max);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(0x21 + Math.floor(this.random() * 94));
    return s;
  }

  private async deviceStat(): Promise<void> {
    const line = await this.request('STAT?\n', (l) => l.startsWith('STAT '), 1500);
    if (!line) return;
    const stat = Object.fromEntries(
      line
        .slice(5)
        .split(' ')
        .map((kv) => kv.split('='))
        .map(([k, v]) => [k, Number(v)]),
    ) as Record<string, number>;
    this.stats.lastDeviceStat = stat;
    if (stat.frames !== this.epochFrames || stat.crcerr !== this.epochCorrupt) {
      this.stats.deviceMismatch++;
      this.note(
        `device counters differ: frames ${stat.frames}/${this.epochFrames}, crcerr ${stat.crcerr}/${this.epochCorrupt}`,
      );
    }
  }

  /** One request of the test device lane. */
  async step(n: number, lastStat: { t: number }, lastReset: { t: number }): Promise<void> {
    const max = this.config.maxPayload ?? 32;
    const now = Date.now();
    if (now - lastStat.t > 30_000) {
      lastStat.t = now;
      return this.deviceStat();
    }
    const resetEvery = (this.config.resetEveryMin ?? 0) * 60_000;
    if (resetEvery && now - lastReset.t > resetEvery) {
      lastReset.t = now;
      await this.deviceStat();
      this.expectingReset = true;
      // Boot messages (ESP32 ROM output) are expected until the device is set up again.
      this.preparing = true;
      const ready = new Promise<void>((resolve) => {
        this.readyResolve = resolve;
      });
      await this.request('RESET\n', (l) => l === 'OK RESET');
      // Wait for the boot message – or for the port to disappear (native USB
      // boards re-enumerate; the run loop then reconnects).
      const deadline = Date.now() + 8000;
      let booted = false;
      void ready.then(() => {
        booted = true;
      });
      while (!booted && this.stats.connected && Date.now() < deadline) await sleep(50);
      this.readyResolve = null;
      if (this.stats.connected) await this.prepare();
      return;
    }
    if (n % 40 === 39) {
      const size = 64 + Math.floor(this.random() * (max >= 32 ? 960 : 192));
      const result = new Promise<{ bytes: number[]; end: string } | null>((resolve) => {
        this.pending = {
          match: (l) => l === `BURST ${size}`,
          // Synchronous: the raw bytes may follow in the same packet.
          resolve: (l) => {
            if (l === null) resolve(null);
            else this.burst = { n: size, got: [], resolve };
          },
          timer: setTimeout(() => {
            this.pending = null;
            resolve(null);
          }, 1000),
        };
      });
      this.stats.requests++;
      await this.write(encoder.encode(`BURST ${size}\n`));
      // Generous: 4096 bytes need about 0.4 s at 115200 baud.
      const got = await Promise.race([result, sleep(3000 + size).then(() => null)]);
      this.burst = null;
      this.stats.bursts++;
      const okBytes = got?.bytes.every((b, i) => b === burstByte(i)) ?? false;
      const okCrc =
        got?.end === `BURSTEND ${burstCrc(size).toString(16).toUpperCase().padStart(4, '0')}`;
      if (okBytes && okCrc) this.stats.ok++;
      else {
        this.stats.burstBad++;
        this.note(`burst ${size} failed (bytes ${okBytes}, crc ${okCrc})`);
      }
      return;
    }
    switch (n % 4) {
      case 0: {
        const reply = await this.request(`PING ${n}\n`, (l) => l.startsWith('PONG '));
        if (reply === `PONG ${n}`) this.stats.ok++;
        else if (reply) this.mismatch(`PING ${n}`, reply);
        return;
      }
      case 1:
      case 3: {
        const corrupt = n % 100 === 51;
        const frame = testFrame(this.payload(max), corrupt);
        const crc = calculateCrc(frame.subarray(2, -2), 'CRC-16/MODBUS');
        const want = corrupt ? 'NAK' : `ACK ${crc.toString(16).toUpperCase().padStart(4, '0')}`;
        const reply = await this.request(
          frame,
          (l) => l.startsWith('ACK ') || l.startsWith('NAK '),
        );
        if (corrupt) this.epochCorrupt++;
        else this.epochFrames++;
        if (corrupt) this.stats.corruptSent++;
        else this.stats.framesSent++;
        if (!reply) return;
        if (corrupt) {
          if (reply.startsWith('NAK ')) this.stats.nakExpected++;
          else {
            this.stats.nakMissing++;
            this.note(`corrupt frame was accepted: ${reply}`);
          }
        } else if (reply === want) this.stats.ok++;
        else if (reply.startsWith('NAK')) {
          this.stats.nakUnexpected++;
          this.note(`valid frame rejected: ${reply}`);
        } else this.mismatch(want, reply);
        return;
      }
      default: {
        const text = this.text(Math.max(4, max - 8));
        const reply = await this.request(`ECHO ${text}\n`, (l) => l.startsWith('ECHO '));
        if (reply === `ECHO ${text}`) this.stats.ok++;
        else if (reply) this.mismatch(`ECHO ${text}`, reply);
      }
    }
  }

  private mismatch(want: string, got: string): void {
    this.stats.mismatches++;
    this.note(`mismatch: wanted "${want.slice(0, 60)}", got "${got.slice(0, 60)}"`);
  }

  /** One block of the loopback lane: sequence number, payload, CRC – must come back unchanged. */
  async loopbackStep(n: number): Promise<void> {
    const payload = this.payload(this.config.maxPayload ?? 48);
    const body = Uint8Array.from([
      0x7e,
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
      payload.length,
      ...payload,
    ]);
    const crc = calculateCrc(body, 'CRC-16/MODBUS');
    const block = Uint8Array.from([...body, crc & 0xff, crc >> 8]);
    const result = new Promise<boolean>((resolve) => {
      this.loopbackWait = { data: block, got: [], resolve };
    });
    const started = performance.now();
    this.stats.requests++;
    await this.write(block);
    const ok = await Promise.race([result, sleep(1000).then(() => null)]);
    this.loopbackWait = null;
    if (ok === null) {
      if (this.stats.connected) this.stats.timeouts++;
      this.buffer = [];
      return;
    }
    if (ok) {
      this.stats.ok++;
      const ms = performance.now() - started;
      if (this.stats.latencies.length < 20_000) this.stats.latencies.push(ms);
    } else {
      this.stats.mismatches++;
      this.note(`loopback block ${n} came back changed`);
    }
  }

  async run(until: number): Promise<void> {
    const lastStat = { t: Date.now() };
    const lastReset = { t: Date.now() };
    let n = 0;
    while (Date.now() < until) {
      if (!this.stats.connected) {
        // Unplugged (hub switch) or reset with USB re-enumeration: find it again.
        await sleep(1000);
        if (await this.open()) {
          this.stats.reconnects++;
          this.stats.downtimeMs += Date.now() - this.downSince;
          this.note(`reconnected on ${this.path}`);
          if (!(await this.prepare())) await this.close();
        }
        continue;
      }
      if (this.config.role === 'loopback') await this.loopbackStep(n);
      else await this.step(n, lastStat, lastReset);
      n++;
      await sleep(this.config.gapMs ?? 20);
    }
    if (this.stats.connected && this.config.role === 'testdevice') {
      await this.request('STREAM 0\n', (l) => l.startsWith('OK STREAM'));
      await this.request('NMEA 0\n', (l) => l.startsWith('OK NMEA'));
      await this.deviceStat();
    }
  }

  async close(): Promise<void> {
    if (this.stats.connected) {
      this.stats.connected = false;
      await this.manager.close(this.id);
    }
  }

  get portPath(): string {
    return this.path;
  }
}

export interface LaneReport {
  name: string;
  role: LaneConfig['role'];
  path: string;
  stats: Omit<LaneStats, 'latencies'>;
  latency: { p50: number; p95: number; p99: number; max: number; samples: number };
  failures: string[];
}

export interface SoakReport {
  started: string;
  minutes: number;
  lanes: LaneReport[];
  memory: { t: number; rss: number; heapUsed: number }[];
  verdict: 'PASS' | 'FAIL';
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return (
    Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0) * 10) / 10
  );
}

function judge(lane: Lane, configured: boolean): string[] {
  const s = lane.stats;
  const f: string[] = [];
  if (!configured) return ['device not found'];
  if (s.ok === 0) f.push('no successful request');
  if (s.mismatches) f.push(`${s.mismatches} changed answers`);
  if (s.timeouts) f.push(`${s.timeouts} timeouts`);
  if (s.nakUnexpected) f.push(`${s.nakUnexpected} valid frames rejected`);
  if (s.nakMissing) f.push(`${s.nakMissing} corrupt frames accepted`);
  if (s.streamGaps) f.push(`${s.streamGaps} gaps in the streams`);
  if (s.streamBad) f.push(`${s.streamBad} damaged stream lines`);
  if (s.burstBad) f.push(`${s.burstBad} failed bursts`);
  if (s.deviceMismatch) f.push(`${s.deviceMismatch} device counter differences`);
  if (s.reboots) f.push(`${s.reboots} unexpected reboots`);
  if (s.unexpected) f.push(`${s.unexpected} unexpected lines/bytes`);
  const fault = lane.config.faultEvery ?? 0;
  if (!fault && s.nmeaBad) f.push(`${s.nmeaBad} NMEA checksum errors`);
  return f;
}

/** Runs all lanes in parallel for `minutes` and returns the report. */
export async function runSoak(
  config: SoakConfig,
  minutes: number,
  log: (lane: string, text: string) => void = () => undefined,
): Promise<SoakReport> {
  const never = new Set(config.never ?? []);
  for (const l of config.lanes) {
    if (l.serialNumber && never.has(l.serialNumber))
      throw new Error(`${l.name}: serial number ${l.serialNumber} must never be opened`);
    if (!l.serialNumber && !l.path) throw new Error(`${l.name}: needs serialNumber or path`);
  }
  const lanes: Lane[] = [];
  const manager = new SerialManager((event: SerialEvent) => {
    const lane = lanes.find((l) => `soak-${l.config.name}` === event.id);
    if (!lane) return;
    if (event.kind === 'data') for (const c of event.chunks) lane.onData(c.data);
    else lane.onClosed(event.lost);
  });
  config.lanes.forEach((c, i) => lanes.push(new Lane(c, manager, log, 0x5eed + i)));
  const started = new Date();
  const until = Date.now() + minutes * 60_000;
  const memory: SoakReport['memory'] = [];
  const sample = () => {
    const m = process.memoryUsage();
    memory.push({
      t: Math.round((Date.now() - started.getTime()) / 1000),
      rss: m.rss,
      heapUsed: m.heapUsed,
    });
  };
  sample();
  const sampler = setInterval(sample, Math.max(5_000, Math.min(60_000, (minutes * 60_000) / 60)));
  const configured = new Map<Lane, boolean>();
  try {
    await Promise.all(
      lanes.map(async (lane) => {
        const ok = (await lane.open()) && (await lane.prepare());
        configured.set(lane, ok);
        if (!ok) {
          log(lane.config.name, 'not usable – skipped');
          await lane.close();
          return;
        }
        await lane.run(until);
      }),
    );
  } finally {
    clearInterval(sampler);
    sample();
    for (const lane of lanes) await lane.close();
    await manager.closeAll();
  }
  const reports = lanes.map((lane): LaneReport => {
    const sorted = [...lane.stats.latencies].sort((a, b) => a - b);
    const { latencies: _, ...stats } = lane.stats;
    return {
      name: lane.config.name,
      role: lane.config.role,
      path: lane.portPath,
      stats,
      latency: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: percentile(sorted, 1),
        samples: sorted.length,
      },
      failures: judge(lane, configured.get(lane) ?? false),
    };
  });
  return {
    started: started.toISOString(),
    minutes,
    lanes: reports,
    memory,
    verdict: reports.every((r) => r.failures.length === 0) ? 'PASS' : 'FAIL',
  };
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** Markdown summary, a JSON file with everything and a CSV of the memory samples. */
export function writeReport(report: SoakReport, dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(dir, 'memory.csv'),
    [
      'seconds;rss_mb;heap_mb',
      ...report.memory.map((m) => `${m.t};${mb(m.rss)};${mb(m.heapUsed)}`),
    ].join('\n'),
  );
  const first = report.memory[0];
  const last = report.memory[report.memory.length - 1];
  const rows = report.lanes.map((l) => {
    const s = l.stats;
    return `| ${l.name} | ${l.role} | ${s.requests} | ${s.ok} | ${s.timeouts} | ${s.mismatches} | ${s.streamLines} | ${s.streamGaps} | ${s.bursts} | ${s.reconnects} | ${(s.downtimeMs / 1000).toFixed(1)} s | ${l.latency.p50} / ${l.latency.p95} / ${l.latency.p99} / ${l.latency.max} | ${l.failures.length ? `❌ ${l.failures.join('; ')}` : '✅'} |`;
  });
  const md = [
    `# Long-run test – ${report.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL'}`,
    '',
    `Started ${report.started}, duration ${report.minutes} min.`,
    first && last
      ? `Memory of the test process: RSS ${mb(first.rss)} → ${mb(last.rss)} MB, heap ${mb(first.heapUsed)} → ${mb(last.heapUsed)} MB.`
      : '',
    '',
    '| Lane | Role | Requests | OK | Timeouts | Changed | Stream lines | Stream gaps | Bursts | Reconnects | Down | Latency p50/p95/p99/max ms | Result |',
    '| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- | --- |',
    ...rows,
    '',
    ...report.lanes.flatMap((l) => [
      `## ${l.name} (${l.path || 'not connected'})`,
      '',
      l.stats.lastDeviceStat
        ? `Device counters: \`${JSON.stringify(l.stats.lastDeviceStat)}\``
        : '',
      '',
      ...l.stats.notes.slice(-30).map((n) => `- ${n}`),
      '',
    ]),
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), md);
  return md;
}
