// Persistent user settings with defaults and validation.

import type { LanguageSetting } from '../i18n';
import {
  normalizeList,
  normalizeSchedule,
  normalizeTrigger,
  type Schedule,
  type Trigger,
} from './automation';
import { isNewline, type Newline } from './newline';
import { TERMINAL_ENTER, type TerminalEnter } from './terminal';
import { CRC_NAMES } from './crc';
import type { FileSendMode } from './filesend';
import { isDataFormat, type DataFormat } from './format';
import type { LengthCounts } from './frames';
import { TIMESTAMP_FORMATS, type TimestampFormat } from './timestamp';
import { DEFAULT_TRANSMIT_CRC, type TransmitCrcConfig } from './transmit-crc';
import { COLOR_PATTERN, EXTRACT_MODES, type ExtractMode, type GraphChannel } from './values';

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000,
  921600, 1000000, 2000000,
] as const;
/** Limits of periodic sending in the Monitor (ms). */
export const PERIODIC_MIN_MS = 10;
export const PERIODIC_MAX_MS = 3_600_000;

export const DATA_BITS = [5, 6, 7, 8] as const;
export const PARITIES = ['None', 'Even', 'Odd', 'Mark', 'Space'] as const;
export const STOP_BITS = ['1', '1.5', '2'] as const;
/** Handshake: none, hardware (RTS/CTS) or software (XON/XOFF). */
export const FLOW_CONTROLS = ['none', 'rtscts', 'xonxoff'] as const;

export type DataBits = (typeof DATA_BITS)[number];
export type Parity = (typeof PARITIES)[number];
export type StopBits = (typeof STOP_BITS)[number];
export type FlowControl = (typeof FLOW_CONTROLS)[number];
export type Theme = 'system' | 'light' | 'dark';
export type RxSplit = 'newline' | 'packet';
export type MonitorView = 'lines' | 'terminal';

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

export interface FileSendConfig {
  mode: FileSendMode;
  blockSize: number;
  pauseMs: number;
}

export interface GraphConfig {
  mode: ExtractMode;
  separator: ',' | ';' | ' ' | '\t';
  points: number;
  /** Channels of the detection mode "own patterns" (regular expressions). */
  channels: GraphChannel[];
  /** Colours chosen for curves of the other modes, by curve name. */
  colors: Record<string, string>;
}

export interface Settings {
  // Connection
  port: string;
  baud: number;
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
  flowControl: FlowControl;
  /** State of the DTR and RTS lines after connecting (and while connected). */
  dtr: boolean;
  rts: boolean;
  autoReconnect: boolean;
  // Display
  display: DataFormat;
  timestamp: boolean;
  timestampFormat: TimestampFormat;
  autoscroll: boolean;
  utf8: boolean;
  showCrlf: boolean;
  /** Show ANSI colours of consoles (ESP-IDF, Zephyr …) and hide other escape sequences. */
  ansi: boolean;
  /** Monitor as lines (with timestamps, formats …) or as an interactive terminal. */
  monitorView: MonitorView;
  /** Terminal: what Enter sends, and whether typed characters are shown locally. */
  terminalEnter: TerminalEnter;
  terminalEcho: boolean;
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
  /** Look for a new release on GitHub at startup. */
  updateCheck: boolean;
  /** Release the user chose to skip – no automatic notice for it any more. */
  updateSkipped: string;
  // Tools
  frame: FrameConfig;
  graph: GraphConfig;
  fileSend: FileSendConfig;
  transmitCrc: TransmitCrcConfig;
  /** Interval of periodic sending in the Monitor. */
  periodicMs: number;
  /** Automation: responses to received patterns and timed sends. */
  triggers: Trigger[];
  schedules: Schedule[];
  /** Folders chosen by the user ('' = default): commands/automation and logs/exports. */
  paths: { dataDir: string; logDir: string };
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze<Settings>({
  port: '',
  baud: 115200,
  dataBits: 8,
  parity: 'None',
  stopBits: '1',
  flowControl: 'none',
  dtr: true,
  rts: true,
  autoReconnect: false,
  display: 'ASCII',
  timestamp: true,
  timestampFormat: 'time-ms',
  autoscroll: true,
  utf8: false,
  showCrlf: false,
  ansi: true,
  monitorView: 'lines',
  terminalEnter: 'CR',
  terminalEcho: false,
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
  updateCheck: true,
  updateSkipped: '',
  frame: {
    header: '',
    footer: '',
    lengthSize: 0,
    lengthCounts: 'payload',
    crc: '',
    crcBigEndian: true,
    fixedLength: 0,
  },
  graph: { mode: 'auto', separator: ',', points: 500, channels: [], colors: {} },
  fileSend: { mode: 'blocks', blockSize: 64, pauseMs: 10 },
  transmitCrc: { ...DEFAULT_TRANSMIT_CRC },
  periodicMs: 1000,
  triggers: [],
  schedules: [],
  paths: { dataDir: '', logDir: '' },
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
  const fs = asDict(s.fileSend);
  const c = asDict(s.transmitCrc);
  return {
    port: str(s.port, D.port),
    baud: int(s.baud, D.baud, 50, 20_000_000),
    dataBits: oneOf(DATA_BITS, Number(s.dataBits), D.dataBits),
    parity: oneOf(PARITIES, s.parity, D.parity),
    stopBits: oneOf(STOP_BITS, String(s.stopBits), D.stopBits),
    flowControl: oneOf(FLOW_CONTROLS, s.flowControl, D.flowControl),
    dtr: bool(s.dtr, D.dtr),
    rts: bool(s.rts, D.rts),
    autoReconnect: bool(s.autoReconnect, D.autoReconnect),
    display: isDataFormat(s.display) ? s.display : D.display,
    timestamp: bool(s.timestamp, D.timestamp),
    timestampFormat: oneOf(TIMESTAMP_FORMATS, s.timestampFormat, D.timestampFormat),
    autoscroll: bool(s.autoscroll, D.autoscroll),
    utf8: bool(s.utf8, D.utf8),
    showCrlf: bool(s.showCrlf, D.showCrlf),
    ansi: bool(s.ansi, D.ansi),
    monitorView: oneOf(['lines', 'terminal'] as const, s.monitorView, D.monitorView),
    terminalEnter: oneOf(TERMINAL_ENTER, s.terminalEnter, D.terminalEnter),
    terminalEcho: bool(s.terminalEcho, D.terminalEcho),
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
    updateCheck: bool(s.updateCheck, D.updateCheck),
    updateSkipped: str(s.updateSkipped, D.updateSkipped),
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
      mode: oneOf(EXTRACT_MODES, g.mode, D.graph.mode),
      separator: oneOf([',', ';', ' ', '\t'] as const, g.separator, D.graph.separator),
      points: int(g.points, D.graph.points, 50, 5000),
      channels: (Array.isArray(g.channels) ? g.channels : []).slice(0, 16).map((value) => {
        const c = asDict(value);
        return {
          name: str(c.name, ''),
          pattern: str(c.pattern, ''),
          color: COLOR_PATTERN.test(String(c.color)) ? String(c.color) : '#3b82f6',
          enabled: bool(c.enabled, true),
        };
      }),
      colors: Object.fromEntries(
        Object.entries(asDict(g.colors))
          .filter(([, v]) => COLOR_PATTERN.test(String(v)))
          .slice(0, 64)
          .map(([k, v]) => [k, String(v)]),
      ),
    },
    fileSend: {
      mode: oneOf(['blocks', 'lines'] as const, fs.mode, D.fileSend.mode),
      blockSize: int(fs.blockSize, D.fileSend.blockSize, 1, 4096),
      pauseMs: int(fs.pauseMs, D.fileSend.pauseMs, 0, 60_000),
    },
    transmitCrc: {
      enabled: bool(c.enabled, D.transmitCrc.enabled),
      algorithm: oneOf(CRC_NAMES, c.algorithm, D.transmitCrc.algorithm),
      bigEndian: bool(c.bigEndian, D.transmitCrc.bigEndian),
      // Retain finite out-of-range values: transmission must reject them, not move the CRC.
      position:
        typeof c.position === 'number' && Number.isFinite(c.position)
          ? c.position
          : D.transmitCrc.position,
      useHeader: bool(c.useHeader, D.transmitCrc.useHeader),
      header: str(c.header, D.transmitCrc.header),
      useFooter: bool(c.useFooter, D.transmitCrc.useFooter),
      footer: str(c.footer, D.transmitCrc.footer),
      includeHeader: bool(c.includeHeader, D.transmitCrc.includeHeader),
      includeFooter: bool(c.includeFooter, D.transmitCrc.includeFooter),
    },
    periodicMs: int(s.periodicMs, D.periodicMs, PERIODIC_MIN_MS, PERIODIC_MAX_MS),
    triggers: normalizeList(s.triggers, normalizeTrigger),
    schedules: normalizeList(s.schedules, normalizeSchedule),
    paths: {
      dataDir: str(asDict(s.paths).dataDir, '').trim(),
      logDir: str(asDict(s.paths).logDir, '').trim(),
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
    autoscroll: s.autoscroll ?? s.auto_scroll,
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
    // CustomTkinter version (serial_monitor_settings.json)
    transmitCrc: {
      enabled: s.crc_on,
      algorithm: s.crc_method,
      bigEndian: typeof s.crc_endian === 'string' ? s.crc_endian !== 'Little-Endian' : undefined,
      position: legacyCrcPosition(s.crc_position, s.crc_index),
      useHeader: s.use_header,
      header: s.header,
      useFooter: s.use_footer,
      footer: s.footer,
      includeHeader: s.crc_include_header,
      includeFooter: s.crc_include_footer,
    },
    periodicMs: s.periodic_ms,
    // Python "log_path"; its "presets_path" held Python files and is only used for the import.
    paths: { logDir: s.log_path },
  });
}

/**
 * The Python version knew "Append" and "Insert at index" with a separate
 * index (0 = in front of the data). Here 0 means "append"; inserting in front
 * of everything is the negative data length, which cannot be stored without
 * the data – such a setting falls back to "append".
 */
function legacyCrcPosition(mode: unknown, index: unknown): number | undefined {
  if (mode === 'Append') return 0;
  if (mode !== 'Insert at index') return undefined;
  const n = Number(index);
  return Number.isSafeInteger(n) && n !== 0 ? n : 0;
}
