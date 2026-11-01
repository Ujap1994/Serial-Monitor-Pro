// Connection of the monitor and distribution of received data.

import { formatCount, t } from '@shared/i18n';
import { StreamAssembler } from '@shared/core/assembler';
import { commandParts, type Command, type CommandPart, type Newline } from '@shared/core/commands';
import { monitorSendBytes } from '@shared/core/transmit-crc';
import { sendPieces, type FileSendMode } from '@shared/core/filesend';
import { InputError, type DataFormat } from '@shared/core/format';
import { fileStamp } from '@shared/core/timestamp';
import { CAPTURE_EXTENSION, formatDuration } from '@shared/core/capture';
import type {
  BinaryFile,
  Chunk,
  ControlLines,
  Failure,
  ModemLines,
  OpenOptions,
  SerialEvent,
} from '@shared/ipc';
import {
  MonitorModel,
  lineToText,
  renderEntry,
  type Entry,
  type RenderOptions,
} from '../lib/monitor';
import { Emitter } from '../lib/store';
import { appStore, setBusy, setStatus, updateSettings } from './app';
import { alertDialog } from './ui';

export const MAIN = 'main';

export const monitor = new MonitorModel();
/** Raw chunks received on the monitor connection (for the analysis tools). */
export const rxBus = new Emitter<Chunk>();
/** Events of the multi-port connections. */
export const multiPortBus = new Emitter<SerialEvent>();
/** Bytes the user sent by hand (Monitor input, presets) – for macro recording. */
export const manualTxBus = new Emitter<{ data: Uint8Array; t: number }>();

// ── Counters (pushed to the store four times per second) ─────────────────────
let rxBytes = 0;
let txBytes = 0;
let lastRx = 0;
let lastTx = 0;

setInterval(() => {
  const s = appStore.get();
  const rxRate = (rxBytes - lastRx) * 4;
  const txRate = (txBytes - lastTx) * 4;
  lastRx = rxBytes;
  lastTx = txBytes;
  if (
    s.rxBytes !== rxBytes ||
    s.txBytes !== txBytes ||
    s.rxRate !== rxRate ||
    s.txRate !== txRate
  ) {
    appStore.set({ rxBytes, txBytes, rxRate, txRate });
  }
}, 250);

export function resetCounters(): void {
  rxBytes = txBytes = lastRx = lastTx = 0;
  appStore.set({ rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 });
}

// ── Monitor content ──────────────────────────────────────────────────────────
const assembler = new StreamAssembler('newline', 100);
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastRxTime: number | null = null;

export function renderOptions(): RenderOptions {
  const s = appStore.get().settings;
  return {
    display: s.display,
    utf8: s.utf8,
    showCrlf: s.showCrlf,
    ansi: s.ansi,
    hexdump: s.hexdump,
    timestamp: s.timestamp,
    timestampFormat: s.timestampFormat,
    deltaTime: s.deltaTime,
  };
}

function addRx(entry: { t: number; data: Uint8Array }): void {
  // "Pause receiving" of the stop condition: counters and analysis tools keep
  // running, but the Monitor display stays frozen at the stop point.
  if (appStore.get().monitorPaused) return;
  const delta = lastRxTime === null ? null : entry.t - lastRxTime;
  lastRxTime = entry.t;
  monitor.add({ kind: 'rx', t: entry.t, raw: entry.data, delta });
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  const timeout = appStore.get().settings.lineTimeoutMs;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const pending = assembler.flush(performance.timeOrigin + performance.now() + 1);
    if (pending) addRx(pending);
    else if (assembler.pending) scheduleFlush();
  }, timeout + 2);
}

function flushPending(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const pending = assembler.flushAll();
  if (pending) addRx(pending);
}

export function systemLine(text: string, kind: Entry['kind'] = 'sys'): void {
  monitor.add({ kind, t: Date.now(), text });
}

export function setMonitorPaused(paused: boolean): void {
  if (appStore.get().monitorPaused === paused) return;
  appStore.set({ monitorPaused: paused });
  systemLine(paused ? t('monitor.paused') : t('monitor.resumed'), paused ? 'err' : 'ok');
}

export function clearMonitor(): void {
  monitor.clear();
  lastRxTime = null;
}

appStore.subscribe(() => {
  const s = appStore.get().settings;
  assembler.configure(s.rxSplit, s.lineTimeoutMs);
  monitor.setMax(s.maxLines);
});

// ── File log ─────────────────────────────────────────────────────────────────
let logActive = false;

monitor.appended.on((entries) => {
  if (!logActive) return;
  const o = renderOptions();
  window.smp.log.write(entries.map((e) => `${lineToText(renderEntry(e, o))}\n`).join(''));
});

export async function startFileLog(): Promise<boolean> {
  const path = await window.smp.log.start(`serial_log_${fileStamp()}.txt`);
  if (!path) return false;
  logActive = true;
  window.smp.log.write(`--- ${t('log.started')}: ${new Date().toLocaleString()} ---\n`);
  setStatus(t('log.running', { path }), 'ok');
  return true;
}

export async function stopFileLog(): Promise<void> {
  if (!logActive) return;
  window.smp.log.write(`--- ${t('log.stopped')}: ${new Date().toLocaleString()} ---\n`);
  logActive = false;
  await window.smp.log.stop();
  setStatus(t('log.closed'));
}

// ── Session capture ──────────────────────────────────────────────────────────
export async function startCapture(): Promise<boolean> {
  const path = await window.smp.capture.start(MAIN, `capture_${fileStamp()}.${CAPTURE_EXTENSION}`);
  if (!path) return false;
  appStore.set({ capturing: path });
  setStatus(t('capture.started', { path }), 'ok');
  return true;
}

export async function stopCapture(): Promise<void> {
  const stats = await window.smp.capture.stop();
  appStore.set({ capturing: null });
  if (!stats) return;
  if (stats.error) {
    setStatus(t('capture.failed', { error: stats.error }), 'error');
    return;
  }
  setStatus(
    t('capture.stopped', {
      path: stats.path,
      rx: formatCount(stats.rxBytes),
      tx: formatCount(stats.txBytes),
      duration: formatDuration(stats.durationMs),
    }),
    'ok',
  );
}

export function toggleCapture(): Promise<unknown> {
  return appStore.get().capturing ? stopCapture() : startCapture();
}

// ── Ports ────────────────────────────────────────────────────────────────────
export async function refreshPorts(): Promise<void> {
  const s = appStore.get();
  const ports = await window.smp.serial.list(s.settings.simulator);
  appStore.set({ ports });
  // Pick a port only if none is chosen yet. A saved port that is currently
  // missing stays selected (shown as "not connected") – the device may simply
  // be unplugged, or it is a symbolic link such as /dev/serial/by-id/….
  if (!appStore.get().settings.port && ports[0] && appStore.get().connection === 'disconnected') {
    updateSettings({ port: ports[0].path });
  }
}

/** Explanation for a failed open, depending on the cause and the platform. */
export function describeFailure(result: Failure, path: string): string {
  const platform = appStore.get().info?.platform;
  const group = appStore.get().info?.serialGroup ?? 'dialout';
  let hint = '';
  if (result.code === 'in-use') return t('error.inUse', { port: path });
  if (result.code === 'permission' && platform === 'linux')
    hint = t('error.hint.permissionLinux', { group });
  else if (result.code === 'permission' || result.code === 'busy') hint = t('error.hint.busy');
  else if (result.code === 'not-found') hint = t('error.hint.notFound');
  return hint ? `${result.error}\n\n${hint}` : result.error;
}

// ── Connection ───────────────────────────────────────────────────────────────
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function stopReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function describeSettings(): string {
  const s = appStore.get().settings;
  const flow = s.flowControl === 'none' ? '' : ` ${t(`conn.flow.${s.flowControl}`)}`;
  return `${s.baud} ${s.dataBits}${s.parity[0]}${s.stopBits}${flow}`;
}

/** Output lines as they should be – with hardware flow control the driver owns RTS. */
function controlLines(): ControlLines {
  const s = appStore.get().settings;
  return s.flowControl === 'rtscts' ? { dtr: true, rts: true } : { dtr: s.dtr, rts: s.rts };
}

function openOptions(path: string): OpenOptions {
  const s = appStore.get().settings;
  return {
    path,
    baudRate: s.baud,
    dataBits: s.dataBits,
    parity: s.parity,
    stopBits: s.stopBits,
    flowControl: s.flowControl,
    lines: controlLines(),
  };
}

async function open(path: string): Promise<boolean> {
  const result = await window.smp.serial.open(MAIN, openOptions(path));
  if (!result.ok) {
    appStore.set({ connection: 'disconnected', connectedPath: '' });
    setStatus(t('status.connectFailed'), 'error');
    void alertDialog(t('error.connectTitle'), describeFailure(result, path), 'error');
    return false;
  }
  assembler.reset();
  lastRxTime = null;
  appStore.set({ connection: 'connected', connectedPath: path });
  setStatus(t('status.connected', { port: path, settings: describeSettings() }), 'ok');
  systemLine(t('monitor.connected', { port: path, settings: describeSettings() }), 'ok');
  return true;
}

export async function connect(): Promise<void> {
  const s = appStore.get();
  if (s.connection !== 'disconnected') return;
  const path = s.settings.port;
  if (!path) {
    await alertDialog(
      t('error.noPortTitle'),
      s.ports.length ? t('error.noPortSelected') : t('error.noPortsFound'),
      'warn',
    );
    return;
  }
  appStore.set({ connection: 'connecting' });
  setStatus(t('status.connecting', { port: path }));
  await open(path);
}

export async function disconnect(): Promise<void> {
  stopReconnect();
  const s = appStore.get();
  if (s.connection === 'reconnecting') {
    appStore.set({ connection: 'disconnected', connectedPath: '' });
    setStatus(t('status.reconnectCancelled'));
    return;
  }
  if (s.connection !== 'connected') return;
  flushPending();
  await window.smp.serial.close(MAIN);
}

export function toggleConnection(): Promise<void> {
  return appStore.get().connection === 'disconnected' ? connect() : disconnect();
}

/**
 * Tries to reopen the port once per second. The port is opened directly
 * instead of waiting for it to show up in the port list – symbolic links such
 * as /dev/serial/by-id/… never appear there but are the most stable way to
 * address a device on Linux.
 */
function scheduleReconnect(path: string): void {
  stopReconnect();
  reconnectTimer = setTimeout(() => {
    void (async () => {
      if (appStore.get().connection !== 'reconnecting') return;
      const result = await window.smp.serial.open(MAIN, openOptions(path));
      if (result.ok && appStore.get().connection === 'reconnecting') {
        assembler.reset();
        appStore.set({ connection: 'connected', connectedPath: path });
        setStatus(t('status.reconnected', { port: path }), 'ok');
        systemLine(t('monitor.reconnected', { port: path }), 'ok');
        void refreshPorts();
        return;
      }
      if (result.ok) await window.smp.serial.close(MAIN);
      if (appStore.get().connection === 'reconnecting') scheduleReconnect(path);
    })();
  }, 1000);
}

function onMainEvent(event: SerialEvent): void {
  if (event.kind === 'data') {
    for (const chunk of event.chunks) {
      rxBytes += chunk.data.length;
      rxBus.emit(chunk);
      for (const entry of assembler.push(chunk)) addRx(entry);
    }
    if (assembler.pending) scheduleFlush();
    return;
  }
  // closed
  flushPending();
  stopPeriodic('disconnected');
  const wasConnected = appStore.get().connection === 'connected';
  if (event.lost && wasConnected) {
    const detail = event.error ? ` (${event.error})` : '';
    systemLine(t('monitor.lost', { port: event.path }) + detail, 'err');
    if (appStore.get().settings.autoReconnect) {
      appStore.set({ connection: 'reconnecting' });
      setStatus(t('status.reconnecting', { port: event.path }), 'warn');
      scheduleReconnect(event.path);
      return;
    }
    setStatus(t('status.lost', { port: event.path }), 'error');
  } else if (wasConnected) {
    systemLine(t('monitor.disconnected', { port: event.path }));
    setStatus(t('status.disconnected'));
  }
  appStore.set({ modemLines: null });
  if (appStore.get().connection !== 'reconnecting') {
    appStore.set({ connection: 'disconnected', connectedPath: '' });
  }
}

export function initSerial(): () => void {
  return window.smp.serial.onEvent((event) => {
    if (event.id === MAIN) onMainEvent(event);
    else multiPortBus.emit(event);
  });
}

// ── Control lines ────────────────────────────────────────────────────────────
/** Switches DTR or RTS; while disconnected it only sets the state for the next connection. */
export async function setControlLine(line: 'dtr' | 'rts', on: boolean): Promise<void> {
  if (appStore.get().settings.flowControl === 'rtscts') return;
  if (isConnected()) {
    const result = await window.smp.serial.setLines(MAIN, { ...controlLines(), [line]: on });
    if (!result.ok) {
      setStatus(t('status.linesFailed', { error: result.error }), 'error');
      return;
    }
  }
  updateSettings(line === 'dtr' ? { dtr: on } : { rts: on });
}

export async function sendBreak(): Promise<void> {
  if (!isConnected() || appStore.get().settings.flowControl === 'rtscts') return;
  const result = await window.smp.serial.sendBreak(MAIN, 250);
  if (!result.ok) {
    setStatus(t('status.linesFailed', { error: result.error }), 'error');
    return;
  }
  setStatus(t('status.breakSent'), 'ok');
  systemLine(t('status.breakSent'));
}

const sameLines = (a: ModemLines | null, b: ModemLines | null): boolean =>
  a === b || (!!a && !!b && a.cts === b.cts && a.dsr === b.dsr && a.dcd === b.dcd);

// The inputs (CTS, DSR, DCD) are polled while connected – there is no
// portable way to be notified when they change.
let polling = false;
setInterval(() => {
  if (polling || appStore.get().connection !== 'connected') return;
  polling = true;
  void window.smp.serial.getLines(MAIN).then((result) => {
    polling = false;
    const lines = result.ok && appStore.get().connection === 'connected' ? result.value : null;
    if (!sameLines(appStore.get().modemLines, lines)) appStore.set({ modemLines: lines });
  });
}, 250);

// ── Sending a file ───────────────────────────────────────────────────────────
export interface FileSendOptions {
  mode: FileSendMode;
  blockSize: number;
  pauseMs: number;
}

export type FileSendOutcome = 'done' | 'cancelled' | 'failed';
let fileSending = false;
let activeWrites = 0;

/**
 * Sends a file piece by piece; `signal` cancels. The monitor gets one line at
 * the start and one at the end instead of every piece – a file of several
 * megabytes would otherwise flood it.
 */
export async function sendFile(
  file: BinaryFile,
  options: FileSendOptions,
  onProgress: (sent: number, total: number) => void,
  signal: AbortSignal,
): Promise<FileSendOutcome> {
  if (signal.aborted) return 'cancelled';
  if (
    fileSending ||
    activeWrites ||
    appStore
      .get()
      .busyTabs.some((tab) => tab === 'automation' || tab === 'sendtable' || tab === 'monitor')
  ) {
    setStatus(t('sendfile.busy'), 'warn');
    return 'failed';
  }
  const pieces = sendPieces(file.data, options.mode, options.blockSize);
  const total = file.data.length;
  const started = performance.now();
  let sent = 0;
  let reported = 0;
  let outcome: FileSendOutcome = 'done';
  fileSending = true;
  // Closing the port releases a write/drain stalled by flow control.
  const cancel = (): void => {
    void disconnect();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    systemLine(t('sendfile.started', { name: file.name, bytes: formatCount(total) }));
    onProgress(0, total);
    for (const piece of pieces) {
      if (signal.aborted) {
        outcome = 'cancelled';
        break;
      }
      const result = isConnected()
        ? await window.smp.serial.write(MAIN, piece)
        : ({ ok: false } as const);
      if (!result.ok) {
        outcome = signal.aborted ? 'cancelled' : 'failed';
        break;
      }
      sent += piece.length;
      txBytes += piece.length;
      if (performance.now() - reported > 50 || sent === total) {
        reported = performance.now();
        onProgress(sent, total);
      }
      if (options.pauseMs > 0 && sent < total) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, options.pauseMs);
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted) done();
        });
      }
    }
  } catch {
    outcome = signal.aborted ? 'cancelled' : 'failed';
  } finally {
    signal.removeEventListener('abort', cancel);
    fileSending = false;
  }
  if (outcome === 'done' && signal.aborted && sent < total) outcome = 'cancelled';
  onProgress(sent, total);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const counts = { sent: formatCount(sent), total: formatCount(total) };
  if (outcome === 'done') {
    systemLine(t('sendfile.done', { name: file.name, bytes: formatCount(total), seconds }), 'ok');
  } else if (outcome === 'cancelled') {
    systemLine(t('sendfile.cancelled', counts));
  } else {
    systemLine(t('sendfile.failed', counts), 'err');
    setStatus(t('sendfile.failed', counts), 'error');
  }
  return outcome;
}

// ── Sending ──────────────────────────────────────────────────────────────────
async function write(
  data: Uint8Array,
  fmt: DataFormat,
  label?: string,
  manual = false,
): Promise<boolean> {
  if (fileSending) {
    setStatus(t('sendfile.busy'), 'warn');
    return false;
  }
  activeWrites++;
  try {
    const result = await window.smp.serial.write(MAIN, data);
    if (!result.ok) {
      setStatus(t('status.sendFailed'), 'error');
      return false;
    }
    txBytes += data.length;
    if (manual) manualTxBus.emit({ data, t: performance.now() });
    if (appStore.get().settings.echoSent)
      monitor.add({ kind: 'tx', t: Date.now(), raw: data, fmt, label });
    return true;
  } finally {
    activeWrites--;
  }
}

/** Keys typed into the terminal: sent as they are, without a line in the monitor. */
export async function sendTerminal(data: Uint8Array): Promise<boolean> {
  if (!data.length) return false;
  if (!isConnected()) {
    setStatus(t('terminal.notConnected'), 'warn');
    return false;
  }
  if (fileSending) {
    setStatus(t('sendfile.busy'), 'warn');
    return false;
  }
  const result = await window.smp.serial.write(MAIN, data);
  if (!result.ok) {
    setStatus(t('status.sendFailed'), 'error');
    return false;
  }
  txBytes += data.length;
  manualTxBus.emit({ data, t: performance.now() });
  return true;
}

export function isConnected(): boolean {
  return appStore.get().connection === 'connected';
}

/**
 * Sends user input. Returns false and shows a message if the input cannot be
 * interpreted in the selected format.
 */
export async function sendText(text: string, fmt: DataFormat, newline: Newline): Promise<boolean> {
  if (!isConnected()) {
    await alertDialog(t('error.notConnectedTitle'), t('error.notConnected'), 'warn');
    return false;
  }
  let data: Uint8Array;
  try {
    data = monitorSendBytes(text, fmt, newline, appStore.get().settings.transmitCrc);
  } catch (err) {
    const message = err instanceof InputError ? err.message : String(err);
    await alertDialog(
      t('error.inputTitle'),
      t('error.inputFormat', { text, fmt, message }),
      'warn',
    );
    return false;
  }
  if (!data.length) return false;
  return write(data, fmt, undefined, true);
}

/**
 * Sends a stored command. `quiet` suppresses message boxes – while a sequence
 * is running they would be disruptive; the sequence reports the abort itself.
 */
export async function sendCommand(cmd: Command, quiet = false): Promise<boolean> {
  if (!isConnected()) {
    if (!quiet) await alertDialog(t('error.notConnectedTitle'), t('error.notConnected'), 'warn');
    return false;
  }
  let parts: CommandPart[];
  try {
    parts = commandParts(cmd, appStore.get().settings.transmitCrc);
  } catch (err) {
    if (!quiet) {
      const message = err instanceof Error ? err.message : String(err);
      await alertDialog(
        t('error.inputTitle'),
        t('error.commandInvalid', { name: cmd.name, fmt: cmd.fmt, message }),
        'warn',
      );
    }
    return false;
  }
  if (!parts.some((p) => p.data.length)) return false;
  return writeParts(parts, cmd.fmt, cmd.name, !quiet);
}

/** Writes the parts of a command (sequence steps) with their pauses. */
async function writeParts(
  parts: readonly CommandPart[],
  fmt: DataFormat,
  label: string | undefined,
  manual: boolean,
  alive: () => boolean = () => true,
): Promise<boolean> {
  for (const part of parts) {
    if (!alive()) return false;
    if (part.data.length && !(await write(part.data, fmt, label, manual))) return false;
    if (part.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, part.pauseMs));
    if (!isConnected()) return false;
  }
  return true;
}

// ── Periodic sending (Monitor input or a preset) ─────────────────────────────
export type PeriodicStop = 'manual' | 'disconnected' | 'invalid' | 'empty' | 'failed';

export interface PeriodicSource {
  /** Name shown in the Monitor and status line. */
  label: string;
  /** Writes of the next round – read anew every time; throws for invalid input. */
  next: () => { parts: CommandPart[]; fmt: DataFormat; label?: string };
  /** Pause after each completed write. */
  intervalMs: () => number;
}

let periodicTimer: ReturnType<typeof setTimeout> | null = null;
let periodicRun = 0;

export function isPeriodicRunning(): boolean {
  return appStore.get().periodic !== null;
}

/**
 * Sends again and again, like "Periodic" of the Python version (Monitor input
 * and presets). The data is read before every send, so edits apply at once;
 * the interval is the pause after each completed write. Only one periodic job
 * runs at a time. Stops on disconnect, on unreadable or empty data and when a
 * write fails.
 */
export async function startPeriodic(source: PeriodicSource): Promise<boolean> {
  if (isPeriodicRunning()) return false;
  if (!isConnected()) {
    await alertDialog(t('error.notConnectedTitle'), t('error.notConnected'), 'warn');
    return false;
  }
  if (fileSending) {
    setStatus(t('sendfile.busy'), 'warn');
    return false;
  }
  const run = ++periodicRun;
  appStore.set({ periodic: source.label });
  setBusy('monitor', true);
  const text = t('periodic.started', { name: source.label, ms: source.intervalMs() });
  systemLine(text);
  setStatus(text);
  const tick = async (): Promise<void> => {
    periodicTimer = null;
    if (run !== periodicRun) return;
    let next: { parts: CommandPart[]; fmt: DataFormat; label?: string };
    try {
      next = source.next();
    } catch (err) {
      stopPeriodic('invalid', err instanceof Error ? err.message : String(err));
      return;
    }
    if (!next.parts.some((p) => p.data.length)) {
      stopPeriodic('empty');
      return;
    }
    const ok =
      isConnected() &&
      (await writeParts(next.parts, next.fmt, next.label, false, () => run === periodicRun));
    if (run !== periodicRun) return;
    if (!ok) {
      stopPeriodic(isConnected() ? 'failed' : 'disconnected');
      return;
    }
    if (run !== periodicRun) return;
    periodicTimer = setTimeout(() => void tick(), source.intervalMs());
  };
  await tick();
  return run === periodicRun && isPeriodicRunning();
}

export function stopPeriodic(reason: PeriodicStop = 'manual', detail = ''): void {
  if (!isPeriodicRunning()) return;
  periodicRun++;
  if (periodicTimer) clearTimeout(periodicTimer);
  periodicTimer = null;
  const name = appStore.get().periodic ?? '';
  appStore.set({ periodic: null });
  setBusy('monitor', false);
  const text = t('periodic.stopped', {
    name,
    reason: t(`periodic.reason.${reason}`) + (detail ? ` – ${detail}` : ''),
  });
  systemLine(text, reason === 'manual' || reason === 'disconnected' ? 'sys' : 'err');
  setStatus(text, reason === 'manual' ? 'info' : 'warn');
}
