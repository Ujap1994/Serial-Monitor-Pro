// Persistent user settings with defaults and validation.

import type { LanguageSetting } from '../i18n';
import { isNewline, type Newline } from './commands';
import { CRC_NAMES } from './crc';
import { isDataFormat, type DataFormat } from './format';
import type { LengthCounts } from './frames';
import { TIMESTAMP_FORMATS, type TimestampFormat } from './timestamp';
import type { ExtractMode } from './values';

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000,
  921600, 1000000, 2000000,
] as const;
export const DATA_BITS = [5, 6, 7, 8] as const;
export const PARITIES = ['None', 'Even', 'Odd', 'Mark', 'Space'] as const;
export const STOP_BITS = ['1', '1.5', '2'] as const;

export type DataBits = (typeof DATA_BITS)[number];
export type Parity = (typeof PARITIES)[number];
export type StopBits = (typeof STOP_BITS)[number];
export type Theme = 'system' | 'light' | 'dark';
export type RxSplit = 'newline' | 'packet';

export interface FrameConfig {
  header: string;
  footer: string;
  /** 0 = no length field, 1 = 1 byte, 2 = 2 bytes */
  lengthSize: 0 | 1 | 2;
  lengthCounts: LengthCounts;
  crc: string;
  crcBigEndian: boolean;
  fixedLength: number;
}

export interface GraphConfig {
  mode: ExtractMode;
  separator: ',' | ';' | ' ' | '\t';
  points: number;
}

export interface Settings {
  // Connection
  port: string;
  baud: number;
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
  autoReconnect: boolean;
  // Display
  display: DataFormat;
  timestamp: boolean;
  timestampFormat: TimestampFormat;
  autoscroll: boolean;
  utf8: boolean;
  showCrlf: boolean;
  deltaTime: boolean;
  hexdump: boolean;
  rxSplit: RxSplit;
  lineTimeoutMs: number;
  fontSize: number;
  maxLines: number;
  // Sending
  sendFormat: DataFormat;
  newline: Newline;
  hexUppercase: boolean;
  hexGroup: boolean;
  hexGroupSize: number;
  sendHistory: boolean;
  clearAfterSend: boolean;
  echoSent: boolean;
  // General
  theme: Theme;
  language: LanguageSetting;
  simulator: boolean;
  quickPanel: boolean;
  // Tools
  frame: FrameConfig;
  graph: GraphConfig;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze<Settings>({
  port: '',
  baud: 115200,
  dataBits: 8,
  parity: 'None',
  stopBits: '1',
  autoReconnect: false,
  display: 'ASCII',
  timestamp: true,
  timestampFormat: 'time-ms',
  autoscroll: true,
  utf8: false,
  showCrlf: false,
  deltaTime: false,
  hexdump: false,
  rxSplit: 'newline',
  lineTimeoutMs: 100,
  fontSize: 13,
  maxLines: 20000,
  sendFormat: 'HEX',
  newline: 'LF',
  hexUppercase: true,
  hexGroup: true,
  hexGroupSize: 2,
  sendHistory: true,
  clearAfterSend: true,
  echoSent: true,
  theme: 'system',
  language: 'auto',
  simulator: false,
  quickPanel: true,
  frame: {
    header: '',
    footer: '',
    lengthSize: 0,
    lengthCounts: 'payload',
    crc: '',
    crcBigEndian: true,
    fixedLength: 0,
  },
  graph: { mode: 'auto', separator: ',', points: 500 },
});

type Dict = Record<string, unknown>;

const asDict = (v: unknown): Dict =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
function oneOf<T>(values: readonly T[], v: unknown, d: T): T {
  return values.includes(v as T) ? (v as T) : d;
}
function int(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
}

/** Validates arbitrary JSON into complete settings; unknown values fall back to defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const s = asDict(raw);
  const D = DEFAULT_SETTINGS;
  const f = asDict(s.frame);
  const g = asDict(s.graph);
  return {
    port: str(s.port, D.port),
    baud: int(s.baud, D.baud, 50, 20_000_000),
    dataBits: oneOf(DATA_BITS, Number(s.dataBits), D.dataBits),
    parity: oneOf(PARITIES, s.parity, D.parity),
    stopBits: oneOf(STOP_BITS, String(s.stopBits), D.stopBits),
    autoReconnect: bool(s.autoReconnect, D.autoReconnect),
    display: isDataFormat(s.display) ? s.display : D.display,
    timestamp: bool(s.timestamp, D.timestamp),
    timestampFormat: oneOf(TIMESTAMP_FORMATS, s.timestampFormat, D.timestampFormat),
    autoscroll: bool(s.autoscroll, D.autoscroll),
    utf8: bool(s.utf8, D.utf8),
    showCrlf: bool(s.showCrlf, D.showCrlf),
    deltaTime: bool(s.deltaTime, D.deltaTime),
    hexdump: bool(s.hexdump, D.hexdump),
    rxSplit: oneOf(['newline', 'packet'] as const, s.rxSplit, D.rxSplit),
    lineTimeoutMs: int(s.lineTimeoutMs, D.lineTimeoutMs, 5, 5000),
    fontSize: int(s.fontSize, D.fontSize, 9, 32),
    maxLines: int(s.maxLines, D.maxLines, 1000, 200_000),
    sendFormat: isDataFormat(s.sendFormat) ? s.sendFormat : D.sendFormat,
    newline: isNewline(s.newline) ? s.newline : D.newline,
    hexUppercase: bool(s.hexUppercase, D.hexUppercase),
    hexGroup: bool(s.hexGroup, D.hexGroup),
    hexGroupSize: int(s.hexGroupSize, D.hexGroupSize, 1, 8),
    sendHistory: bool(s.sendHistory, D.sendHistory),
    clearAfterSend: bool(s.clearAfterSend, D.clearAfterSend),
    echoSent: bool(s.echoSent, D.echoSent),
    theme: oneOf(['system', 'light', 'dark'] as const, s.theme, D.theme),
    language: oneOf(['auto', 'de', 'en'] as const, s.language, D.language),
    simulator: bool(s.simulator, D.simulator),
    quickPanel: bool(s.quickPanel, D.quickPanel),
    frame: {
      header: str(f.header, D.frame.header),
      footer: str(f.footer, D.frame.footer),
      lengthSize: oneOf([0, 1, 2] as const, f.lengthSize, D.frame.lengthSize),
      lengthCounts: oneOf(
        ['payload', 'payload_crc', 'frame'] as const,
        f.lengthCounts,
        D.frame.lengthCounts,
      ),
      crc: f.crc === '' || CRC_NAMES.includes(f.crc as never) ? (f.crc as string) : D.frame.crc,
      crcBigEndian: bool(f.crcBigEndian, D.frame.crcBigEndian),
      fixedLength: int(f.fixedLength, D.frame.fixedLength, 0, 4096),
    },
    graph: {
      mode: oneOf(['auto', 'labeled', 'separated'] as const, g.mode, D.graph.mode),
      separator: oneOf([',', ';', ' ', '\t'] as const, g.separator, D.graph.separator),
      points: int(g.points, D.graph.points, 50, 5000),
    },
  };
}

const LEGACY_TIMESTAMPS: Record<string, TimestampFormat> = {
  '%H:%M:%S.%f': 'time-ms',
  '%H:%M:%S': 'time',
  '%Y-%m-%d %H:%M:%S': 'datetime',
  '%d.%m. %H:%M:%S': 'date-short',
};

/**
 * Maps the settings file of the former Python version
 * (~/.serial_monitor_pro/settings.json) onto the new format.
 */
export function migrateLegacySettings(raw: unknown): Settings {
  const s = asDict(raw);
  const pt = Number(s.font_size);
  return normalizeSettings({
    port: s.port,
    baud: s.baud,
    dataBits: s.bytesize,
    parity: s.parity,
    stopBits: s.stopbits,
    autoReconnect: s.auto_reconnect,
    display: s.display,
    timestamp: s.timestamp,
    timestampFormat: LEGACY_TIMESTAMPS[String(s.timestamp_format)],
    autoscroll: s.autoscroll,
    utf8: s.utf8,
    showCrlf: s.show_crlf,
    deltaTime: s.deltatime,
    hexdump: s.hexdump,
    // Qt point sizes → CSS pixels
    fontSize: Number.isFinite(pt) ? Math.round((pt * 4) / 3) : undefined,
    maxLines: s.max_lines,
    sendFormat: s.send_format,
    newline: s.newline,
    hexUppercase: s.hex_uppercase,
    hexGroup: s.hex_group,
    hexGroupSize: s.hex_group_size,
    sendHistory: s.send_history,
    clearAfterSend: s.clear_after_send,
    echoSent: s.echo_sent,
    language: s.language,
  });
}
