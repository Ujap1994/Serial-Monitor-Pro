// Connection of the monitor and distribution of received data.

import { t } from '@shared/i18n';
import { StreamAssembler } from '@shared/core/assembler';
import { commandBytes, NEWLINE_BYTES, type Command, type Newline } from '@shared/core/commands';
import { concatBytes } from '@shared/core/bytes';
import { InputError, parseSendData, type DataFormat } from '@shared/core/format';
import { fileStamp } from '@shared/core/timestamp';
import type { Chunk, Failure, SerialEvent } from '@shared/ipc';
import {
  MonitorModel,
  lineToText,
  renderEntry,
  type Entry,
  type RenderOptions,
} from '../lib/monitor';
import { Emitter } from '../lib/store';
import { appStore, setStatus, updateSettings } from './app';
import { alertDialog } from './ui';

export const MAIN = 'main';

export const monitor = new MonitorModel();
/** Raw chunks received on the monitor connection (for the analysis tools). */
export const rxBus = new Emitter<Chunk>();
/** Events of the multi-port connections. */
export const multiPortBus = new Emitter<SerialEvent>();

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
    hexdump: s.hexdump,
    timestamp: s.timestamp,
    timestampFormat: s.timestampFormat,
    deltaTime: s.deltaTime,
  };
}

function addRx(entry: { t: number; data: Uint8Array }): void {
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
  return `${s.baud} ${s.dataBits}${s.parity[0]}${s.stopBits}`;
}

async function open(path: string): Promise<boolean> {
  const s = appStore.get().settings;
  const result = await window.smp.serial.open(MAIN, {
    path,
    baudRate: s.baud,
    dataBits: s.dataBits,
    parity: s.parity,
    stopBits: s.stopBits,
  });
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
      const s = appStore.get().settings;
      const result = await window.smp.serial.open(MAIN, {
        path,
        baudRate: s.baud,
        dataBits: s.dataBits,
        parity: s.parity,
        stopBits: s.stopBits,
      });
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

// ── Sending ──────────────────────────────────────────────────────────────────
async function write(data: Uint8Array, fmt: DataFormat, label?: string): Promise<boolean> {
  const result = await window.smp.serial.write(MAIN, data);
  if (!result.ok) {
    setStatus(t('status.sendFailed'), 'error');
    return false;
  }
  txBytes += data.length;
  if (appStore.get().settings.echoSent)
    monitor.add({ kind: 'tx', t: Date.now(), raw: data, fmt, label });
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
    data = parseSendData(text, fmt);
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
  return write(concatBytes(data, NEWLINE_BYTES[newline]), fmt);
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
  let data: Uint8Array;
  try {
    data = commandBytes(cmd);
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
  if (!data.length) return false;
  return write(data, cmd.fmt, cmd.name);
}
