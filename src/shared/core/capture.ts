// Session capture: every byte of a connection with its direction and time.
//
// File format "smp-capture" version 1 – JSON Lines, so a capture can be written
// while it is running, survives an abrupt end (every complete line is valid)
// and stays readable in a text editor and in a diff:
//
//   {"format":"smp-capture","version":1,"created":"2026-11-01T12:00:00.000Z","app":"1.4.0",
//    "port":{"baudRate":115200,"dataBits":8,"parity":"None","stopBits":"1"}}
//   {"t":0,"d":"open","port":{"baudRate":115200,"dataBits":8,"parity":"None","stopBits":"1"}}
//   {"t":12.4,"d":"tx","x":"49443f0a"}
//   {"t":19.8,"d":"rx","x":"4944205353502d54442f31"}
//   {"t":5000.2,"d":"lines","dtr":false,"rts":true}
//   {"t":7000,"d":"break","ms":250}
//   {"t":9000.1,"d":"close","lost":true}
//
// t: milliseconds since the start of the capture (0.1 ms resolution).
// x: the bytes as lower-case hex without separators.

import type { DataBits, FlowControl, Parity, StopBits } from './settings';

export const CAPTURE_FORMAT = 'smp-capture';
export const CAPTURE_VERSION = 1;
export const CAPTURE_EXTENSION = 'smpcap';

/** Port settings as they are stored – the port name only when wanted. */
export interface CapturePort {
  path?: string;
  baudRate: number;
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
  flowControl?: FlowControl;
}

export interface CaptureHeader {
  format: typeof CAPTURE_FORMAT;
  version: number;
  /** ISO time of the start. */
  created: string;
  /** Version of the application that wrote it. */
  app: string;
  port?: CapturePort;
  note?: string;
}

export type CaptureEvent =
  | { t: number; d: 'rx' | 'tx'; data: Uint8Array }
  | { t: number; d: 'open'; port: CapturePort }
  | { t: number; d: 'close'; lost: boolean }
  | { t: number; d: 'lines'; dtr: boolean; rts: boolean }
  | { t: number; d: 'break'; ms: number };

export interface Capture {
  header: CaptureHeader;
  events: CaptureEvent[];
}

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'CaptureError';
  }
}

const HEX = /^(?:[0-9a-f]{2})*$/;

export function bytesToHex(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += b.toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const lower = hex.toLowerCase();
  if (!HEX.test(lower)) throw new Error('invalid hex data');
  const out = new Uint8Array(lower.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(lower.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const round = (t: number): number => Math.round(t * 10) / 10;

export function encodeCaptureHeader(header: Omit<CaptureHeader, 'format' | 'version'>): string {
  return `${JSON.stringify({ format: CAPTURE_FORMAT, version: CAPTURE_VERSION, ...header })}\n`;
}

export function encodeCaptureEvent(event: CaptureEvent): string {
  const t = round(event.t);
  switch (event.d) {
    case 'rx':
    case 'tx':
      return `${JSON.stringify({ t, d: event.d, x: bytesToHex(event.data) })}\n`;
    case 'open':
      return `${JSON.stringify({ t, d: 'open', port: event.port })}\n`;
    case 'close':
      return `${JSON.stringify({ t, d: 'close', lost: event.lost })}\n`;
    case 'lines':
      return `${JSON.stringify({ t, d: 'lines', dtr: event.dtr, rts: event.rts })}\n`;
    case 'break':
      return `${JSON.stringify({ t, d: 'break', ms: event.ms })}\n`;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parsePort(raw: unknown, line: number): CapturePort {
  if (!isObject(raw) || typeof raw.baudRate !== 'number')
    throw new CaptureError('port settings are missing', line);
  return {
    ...(typeof raw.path === 'string' ? { path: raw.path } : {}),
    baudRate: raw.baudRate,
    dataBits: (raw.dataBits ?? 8) as DataBits,
    parity: (raw.parity ?? 'None') as Parity,
    stopBits: (raw.stopBits ?? '1') as StopBits,
    ...(typeof raw.flowControl === 'string' ? { flowControl: raw.flowControl as FlowControl } : {}),
  };
}

function parseEvent(raw: unknown, line: number): CaptureEvent {
  if (!isObject(raw)) throw new CaptureError('not an event', line);
  const t = raw.t;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0)
    throw new CaptureError('time "t" is missing', line);
  switch (raw.d) {
    case 'rx':
    case 'tx': {
      if (typeof raw.x !== 'string') throw new CaptureError('data "x" is missing', line);
      try {
        return { t, d: raw.d, data: hexToBytes(raw.x) };
      } catch {
        throw new CaptureError('data "x" is not hex', line);
      }
    }
    case 'open':
      return { t, d: 'open', port: parsePort(raw.port, line) };
    case 'close':
      return { t, d: 'close', lost: raw.lost === true };
    case 'lines':
      return { t, d: 'lines', dtr: raw.dtr === true, rts: raw.rts === true };
    case 'break':
      return { t, d: 'break', ms: typeof raw.ms === 'number' ? raw.ms : 0 };
    default:
      throw new CaptureError(`unknown event "${String(raw.d)}"`, line);
  }
}

/**
 * Reads a capture. A last line that was cut off (the program ended while
 * writing) is ignored; every other error names its line.
 */
export function parseCapture(text: string): Capture {
  const lines = text.split('\n');
  let first = '';
  let i = 0;
  while (i < lines.length && !(first = (lines[i] ?? '').trim())) i++;
  let head: unknown;
  try {
    head = JSON.parse(first);
  } catch {
    throw new CaptureError('this is not a Serial Monitor Pro capture', 0);
  }
  if (!isObject(head) || head.format !== CAPTURE_FORMAT)
    throw new CaptureError('this is not a Serial Monitor Pro capture', 0);
  if (typeof head.version !== 'number' || head.version > CAPTURE_VERSION)
    throw new CaptureError(`capture version ${String(head.version)} is not supported`, 0);
  const header: CaptureHeader = {
    format: CAPTURE_FORMAT,
    version: head.version,
    created: typeof head.created === 'string' ? head.created : '',
    app: typeof head.app === 'string' ? head.app : '',
    ...(head.port !== undefined ? { port: parsePort(head.port, i + 1) } : {}),
    ...(typeof head.note === 'string' ? { note: head.note } : {}),
  };
  const events: CaptureEvent[] = [];
  const last = lines.length - 1;
  for (let n = i + 1; n < lines.length; n++) {
    const text = (lines[n] ?? '').trim();
    if (!text) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // Only the very last line may be incomplete (capture cut off).
      if (n === last || lines.slice(n + 1).every((l) => !l.trim())) break;
      throw new CaptureError('not valid JSON', n + 1);
    }
    events.push(parseEvent(raw, n + 1));
  }
  return { header, events };
}

export interface CaptureSummary {
  durationMs: number;
  rxBytes: number;
  txBytes: number;
  rxEvents: number;
  txEvents: number;
  opens: number;
  closes: number;
}

export function captureSummary(events: readonly CaptureEvent[]): CaptureSummary {
  const s: CaptureSummary = {
    durationMs: 0,
    rxBytes: 0,
    txBytes: 0,
    rxEvents: 0,
    txEvents: 0,
    opens: 0,
    closes: 0,
  };
  for (const e of events) {
    s.durationMs = Math.max(s.durationMs, e.t);
    if (e.d === 'rx') {
      s.rxBytes += e.data.length;
      s.rxEvents++;
    } else if (e.d === 'tx') {
      s.txBytes += e.data.length;
      s.txEvents++;
    } else if (e.d === 'open') s.opens++;
    else if (e.d === 'close') s.closes++;
  }
  return s;
}

/** A copy without the port name – for sharing a capture or keeping it as a test fixture. */
export function anonymizeCapture(capture: Capture): Capture {
  const strip = (port: CapturePort): CapturePort => {
    const { path: _, ...rest } = port;
    return rest;
  };
  return {
    header: {
      ...capture.header,
      ...(capture.header.port ? { port: strip(capture.header.port) } : {}),
    },
    events: capture.events.map((e) => (e.d === 'open' ? { ...e, port: strip(e.port) } : e)),
  };
}

export function encodeCapture(capture: Capture): string {
  const { format: _f, version: _v, ...header } = capture.header;
  return encodeCaptureHeader(header) + capture.events.map(encodeCaptureEvent).join('');
}

/** "12.3 s", "4:05 min", "1:02:03 h" */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec} h` : `${m}:${sec} min`;
}
