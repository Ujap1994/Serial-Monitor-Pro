// Serial port management in the main process.
//
// Each connection has an id ("main" for the monitor, "mp0" … "mp3" for the
// multi-port view). Received data is collected for a few milliseconds and
// sent to the renderer in batches – at high baud rates this keeps IPC traffic
// low without losing the exact receive time of each chunk.

import { access, readdir, readFile, readlink } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SerialPort } from 'serialport';
import type {
  Chunk,
  ControlLines,
  Failure,
  ModemLines,
  OpenOptions,
  PortInfo,
  Result,
  SerialErrorCode,
  SerialEvent,
  ValueResult,
} from '@shared/ipc';
import { isSimulatedPath, SimulatedDevice, simulatedPorts } from './simulator';

const BATCH_MS = 8;
/** Line state the operating system sets when a port is opened. */
const DEFAULT_LINES: ControlLines = { dtr: true, rts: true };
/** How often an open port checks that its device node still exists. */
const PRESENCE_MS = 1000;
const PARITY = { None: 'none', Even: 'even', Odd: 'odd', Mark: 'mark', Space: 'space' } as const;

interface Handle {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  setLines(lines: ControlLines): Promise<void>;
  getLines(): Promise<ModemLines>;
  sendBreak(ms: number): Promise<void>;
}

/** Everything that happens on a connection, for the session capture. */
export type TapEvent =
  | { d: 'rx' | 'tx'; t: number; data: Uint8Array }
  | { d: 'open'; t: number; options: OpenOptions }
  | { d: 'close'; t: number; lost: boolean }
  | { d: 'lines'; t: number; lines: ControlLines }
  | { d: 'break'; t: number; ms: number };
export type Tap = (event: TapEvent) => void;

interface Connection {
  path: string;
  options: OpenOptions;
  handle: Handle | null;
  opening: Promise<void>;
  closeTask: Promise<void> | null;
  pending: Chunk[];
  timer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  /** The renderer has been told that this connection ended. */
  ended: boolean;
}

// serialport 13's set() resets every output flag, including RTS. Its native
// bindings also write RTS when it is omitted, so even DTR/BREAK cannot safely
// use that API while the driver owns RTS for hardware flow control.
const HARDWARE_LINES_ERROR =
  'Manual DTR/RTS and BREAK are unavailable with RTS/CTS hardware flow control';

function checkInitialLines(options: OpenOptions): void {
  if (
    options.flowControl === 'rtscts' &&
    options.lines &&
    (!options.lines.dtr || !options.lines.rts)
  ) {
    throw new Error(HARDWARE_LINES_ERROR);
  }
}

export function classifyError(message: string): SerialErrorCode {
  if (/permission denied|access denied|access is denied|EACCES|EPERM/i.test(message))
    return 'permission';
  if (/no such file|not found|ENOENT|cannot find|does not exist/i.test(message)) return 'not-found';
  if (/busy|cannot lock|EBUSY|resource temporarily unavailable|in use/i.test(message))
    return 'busy';
  return 'unknown';
}

function failure(err: unknown, code?: SerialErrorCode): Failure {
  const error = err instanceof Error ? err.message : String(err);
  return { ok: false, error, code: code ?? classifyError(error) };
}

export const now = (): number => performance.timeOrigin + performance.now();

// ── Port listing ──────────────────────────────────────────────────────────────

const LINUX_TTY = /^(ttyUSB|ttyACM|ttyAMA|ttyTHS|ttymxc|ttyGS|ttyXRUSB|rfcomm|ttyS)\d+$/;

/**
 * Fallback for Linux systems where udev information is not available (for
 * example inside a Flatpak sandbox): scans /dev directly.
 */
async function listLinuxFallback(): Promise<PortInfo[]> {
  const byId = new Map<string, string>();
  try {
    for (const name of await readdir('/dev/serial/by-id')) {
      const target = resolvePath('/dev/serial/by-id', await readlink(`/dev/serial/by-id/${name}`));
      byId.set(
        target,
        name
          .replace(/^usb-/, '')
          .replace(/-if\d+.*$/, '')
          .replace(/_/g, ' '),
      );
    }
  } catch {
    // no USB serial devices
  }
  const ports: PortInfo[] = [];
  for (const name of await readdir('/dev').catch(() => [] as string[])) {
    if (!LINUX_TTY.test(name)) continue;
    if (name.startsWith('ttyS')) {
      // Legacy UARTs exist on almost every PC; type 0 means "no hardware".
      const type = await readFile(`/sys/class/tty/${name}/type`, 'utf8').catch(() => '0');
      if (type.trim() === '0') continue;
    }
    const path = `/dev/${name}`;
    ports.push({ path, description: byId.get(path) ?? '' });
  }
  return ports;
}

function naturalCompare(a: PortInfo, b: PortInfo): number {
  return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
}

export async function listPorts(includeSimulated: boolean): Promise<PortInfo[]> {
  let ports: PortInfo[] = [];
  try {
    const found = await SerialPort.list();
    ports = found.map((p) => {
      const friendly = (p as { friendlyName?: string }).friendlyName;
      const description =
        friendly?.replace(/\s*\((COM\d+)\)\s*$/i, '') ||
        [p.manufacturer, p.vendorId && p.productId ? `${p.vendorId}:${p.productId}` : '']
          .filter(Boolean)
          .join(' · ');
      return {
        path: p.path,
        description,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        vendorId: p.vendorId,
        productId: p.productId,
      };
    });
  } catch (err) {
    console.warn('[serial] listing failed:', err);
  }
  if (process.platform === 'linux' && ports.length === 0) {
    ports = await listLinuxFallback();
  }
  ports.sort(naturalCompare);
  return includeSimulated ? [...ports, ...simulatedPorts()] : ports;
}

// ── Opening ───────────────────────────────────────────────────────────────────

interface Callbacks {
  onData(data: Uint8Array): void;
  onClose(lost: boolean, error?: string): void;
}

function openSimulated(options: OpenOptions, cb: Callbacks): Handle {
  checkInitialLines(options);
  const device = new SimulatedDevice(options.path, options.baudRate, {
    onData: (data) => cb.onData(data),
  });
  let lines = options.lines ?? DEFAULT_LINES;
  return {
    write: (data) => {
      device.write(data);
      return Promise.resolve();
    },
    close: () => {
      device.close();
      cb.onClose(false);
      return Promise.resolve();
    },
    setLines: (next) => {
      if (options.flowControl === 'rtscts') return Promise.reject(new Error(HARDWARE_LINES_ERROR));
      device.controlLines(lines, next);
      lines = next;
      return Promise.resolve();
    },
    getLines: () => Promise.resolve(device.modemLines(lines)),
    sendBreak: () =>
      options.flowControl === 'rtscts'
        ? Promise.reject(new Error(HARDWARE_LINES_ERROR))
        : Promise.resolve(),
  };
}

function openReal(options: OpenOptions, cb: Callbacks): Promise<Handle> {
  return new Promise((resolve, reject) => {
    checkInitialLines(options);
    const flow = options.flowControl ?? 'none';
    const port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      dataBits: options.dataBits,
      parity: PARITY[options.parity],
      stopBits: Number(options.stopBits) as 1 | 1.5 | 2,
      rtscts: flow === 'rtscts',
      xon: flow === 'xonxoff',
      xoff: flow === 'xonxoff',
      autoOpen: false,
    });
    let lines = options.lines ?? DEFAULT_LINES;
    // set() replaces all output lines at once – missing ones fall back to the
    // serialport defaults – so the current state always travels along.
    const set = (next: ControlLines, brk: boolean): Promise<void> => {
      if (flow === 'rtscts') return Promise.reject(new Error(HARDWARE_LINES_ERROR));
      if (!port.isOpen) return Promise.reject(new Error('Port is not open'));
      return new Promise((done, fail) =>
        port.set({ ...next, brk }, (err) => (err ? fail(err) : done())),
      );
    };
    // Keep BREAK and line updates ordered. A failed operation must not poison
    // subsequent operations or update the last successfully applied state.
    let controls = Promise.resolve();
    const control = (operation: () => Promise<void>): Promise<void> => {
      const result = controls.then(operation);
      controls = result.catch(() => undefined);
      return result;
    };
    let intentional = false;
    let ready = false;
    let setupError: unknown;
    let closing: Promise<void> | null = null;
    let presence: ReturnType<typeof setInterval> | null = null;
    const close = (): Promise<void> => {
      if (closing) return closing;
      if (!port.isOpen) return Promise.resolve();
      closing = new Promise<void>((done, fail) =>
        port.close((err) => (err ? fail(err) : done())),
      ).finally(() => {
        closing = null;
      });
      return closing;
    };
    port.on('data', (data: Buffer) => cb.onData(new Uint8Array(data)));
    port.on('error', (err: Error) => console.warn(`[serial] ${options.path}:`, err.message));
    port.on('close', (err?: Error & { disconnected?: boolean }) => {
      if (presence) clearInterval(presence);
      presence = null;
      if (ready) cb.onClose(!intentional, err?.message);
      else
        reject(
          setupError instanceof Error
            ? setupError
            : (err ?? new Error('Port closed while opening')),
        );
    });
    port.open((err) => {
      if (err) {
        reject(err);
        return;
      }
      const handle: Handle = {
        write: (data) =>
          new Promise<void>((done, fail) => {
            if (!port.isOpen) return fail(new Error('Port is not open'));
            port.write(Buffer.from(data), (writeErr) => {
              if (writeErr) return fail(writeErr);
              port.drain((drainErr) => (drainErr ? fail(drainErr) : done()));
            });
          }),
        close: async () => {
          intentional = true;
          try {
            await close();
          } catch (error) {
            intentional = false;
            throw error;
          }
        },
        setLines: (next) =>
          control(async () => {
            await set(next, false);
            lines = { ...next };
          }),
        getLines: () =>
          new Promise<ModemLines>((done, fail) =>
            port.get((getErr, status) =>
              getErr
                ? fail(getErr)
                : done({ cts: !!status?.cts, dsr: !!status?.dsr, dcd: !!status?.dcd }),
            ),
          ),
        sendBreak: (ms) =>
          control(async () => {
            await set(lines, true);
            await new Promise((r) => setTimeout(r, ms));
            await set(lines, false);
          }),
      };
      void (async () => {
        try {
          if (lines.dtr !== DEFAULT_LINES.dtr || lines.rts !== DEFAULT_LINES.rts) {
            await set(lines, false);
          }
          if (!port.isOpen) throw new Error('Port closed while opening');
          // Some Unix drivers do not report a vanished device. Watching its
          // node lets auto-reconnect recover without guessing a polling rate.
          if (process.platform !== 'win32') {
            presence = setInterval(() => {
              void access(options.path).catch(() => {
                void close().catch((error: unknown) =>
                  console.warn('[serial] close failed:', error),
                );
              });
            }, PRESENCE_MS);
            presence.unref();
          }
          ready = true;
          resolve(handle);
        } catch (error) {
          setupError = error;
          intentional = true;
          try {
            await close();
          } catch (closeError) {
            console.warn('[serial] cleanup after failed open:', closeError);
          }
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  });
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class SerialManager {
  private readonly connections = new Map<string, Connection>();
  private readonly samples = new Map<string, { stop(): void; done: Promise<void> }>();
  /** Session captures by connection id – they outlive closing and reopening. */
  private readonly taps = new Map<string, Tap>();
  private closingAll: Promise<void> | null = null;

  constructor(private readonly emit: (event: SerialEvent) => void) {}

  /** Records everything of connection `id` (null = stop). */
  setTap(id: string, tap: Tap | null): void {
    if (tap) this.taps.set(id, tap);
    else this.taps.delete(id);
  }

  /** Settings of an open connection. */
  optionsOf(id: string): OpenOptions | null {
    const conn = this.connections.get(id);
    return conn && !conn.closing && !conn.ended ? conn.options : null;
  }

  private tap(id: string, event: TapEvent): void {
    const tap = this.taps.get(id);
    if (!tap) return;
    try {
      tap(event);
    } catch (err) {
      console.warn('[serial] capture failed:', err);
    }
  }

  private pathInUse(path: string, exceptId?: string): boolean {
    if (this.samples.has(path)) return true;
    for (const [id, conn] of this.connections) {
      if (id !== exceptId && conn.path === path) return true;
    }
    return false;
  }

  async open(id: string, options: OpenOptions): Promise<Result> {
    if (this.closingAll) return failure('Serial ports are closing');
    if (this.connections.has(id)) await this.close(id);
    // Another open may have resumed from the same close while this one waited.
    if (this.connections.has(id) || this.closingAll) return failure('Connection is busy', 'busy');
    if (this.pathInUse(options.path, id)) {
      return { ok: false, error: options.path, code: 'in-use' };
    }

    // Reserve the id before the asynchronous open so a quick second request
    // cannot open the same port twice.
    let finishOpening!: () => void;
    const conn: Connection = {
      path: options.path,
      options,
      handle: null,
      opening: new Promise<void>((done) => {
        finishOpening = done;
      }),
      closeTask: null,
      pending: [],
      timer: null,
      closing: false,
      ended: false,
    };
    this.connections.set(id, conn);

    const callbacks: Callbacks = {
      onData: (data) => this.received(id, conn, data),
      onClose: (lost, error) => this.closed(id, conn, lost, error),
    };
    try {
      conn.handle = isSimulatedPath(options.path)
        ? openSimulated(options, callbacks)
        : await openReal(options, callbacks);
      if (conn.closing || conn.ended) return failure('Connection closed while opening');
      this.tap(id, { d: 'open', t: now(), options });
      return { ok: true };
    } catch (err) {
      if (conn.timer) clearTimeout(conn.timer);
      conn.pending = [];
      if (this.connections.get(id) === conn) this.connections.delete(id);
      return failure(err);
    } finally {
      finishOpening();
    }
  }

  private received(id: string, conn: Connection, data: Uint8Array): void {
    if (!data.length || conn.closing || conn.ended) return;
    const t = now();
    conn.pending.push({ t, data });
    this.tap(id, { d: 'rx', t, data });
    conn.timer ??= setTimeout(() => this.flush(id, conn), BATCH_MS);
  }

  private flush(id: string, conn: Connection): void {
    if (conn.timer) clearTimeout(conn.timer);
    conn.timer = null;
    if (!conn.pending.length) return;
    const chunks = conn.pending;
    conn.pending = [];
    this.emit({ kind: 'data', id, chunks });
  }

  private closed(id: string, conn: Connection, lost: boolean, error?: string): void {
    this.flush(id, conn);
    if (this.connections.get(id) === conn) this.connections.delete(id);
    if (conn.ended) return;
    conn.ended = true;
    this.tap(id, { d: 'close', t: now(), lost: lost && !conn.closing });
    this.emit({ kind: 'closed', id, path: conn.path, lost: lost && !conn.closing, error });
  }

  async close(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.closeTask) return conn.closeTask;
    conn.closing = true;
    this.flush(id, conn);
    conn.closeTask = (async () => {
      await conn.opening;
      try {
        // Do not wait for writes/drain: closing the driver is what cancels them.
        await conn.handle?.close();
        this.closed(id, conn, false);
      } catch (err) {
        conn.closing = false;
        conn.closeTask = null;
        throw err;
      }
    })();
    return conn.closeTask;
  }

  /** Closes every connection on `path` (a replay that is removed). */
  async closePath(path: string): Promise<void> {
    const ids = [...this.connections].filter(([, c]) => c.path === path).map(([id]) => id);
    await Promise.allSettled(ids.map((id) => this.close(id)));
  }

  async write(id: string, data: Uint8Array): Promise<Result> {
    const handle = this.live(id);
    if (!handle) return { ok: false, error: 'not connected', code: 'unknown' };
    // Recorded when handed to the driver: an answer may arrive before the write completes.
    this.tap(id, { d: 'tx', t: now(), data });
    try {
      await handle.write(data);
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  }

  private live(id: string): Handle | null {
    const conn = this.connections.get(id);
    return conn && !conn.closing && !conn.ended ? conn.handle : null;
  }

  async setLines(id: string, lines: ControlLines): Promise<Result> {
    const handle = this.live(id);
    if (!handle) return { ok: false, error: 'not connected', code: 'unknown' };
    try {
      await handle.setLines(lines);
      this.tap(id, { d: 'lines', t: now(), lines });
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  }

  async getLines(id: string): Promise<ValueResult<ModemLines>> {
    const handle = this.live(id);
    if (!handle) return { ok: false, error: 'not connected', code: 'unknown' };
    try {
      return { ok: true, value: await handle.getLines() };
    } catch (err) {
      return failure(err);
    }
  }

  async sendBreak(id: string, ms: number): Promise<Result> {
    const handle = this.live(id);
    if (!handle) return { ok: false, error: 'not connected', code: 'unknown' };
    const t = now();
    try {
      await handle.sendBreak(ms);
      this.tap(id, { d: 'break', t, ms });
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  }

  /** Listens on a port for `ms` milliseconds (baud rate scanner). */
  async sample(path: string, baudRate: number, ms: number): Promise<ValueResult<Uint8Array>> {
    if (this.closingAll) return failure('Serial ports are closing');
    if (this.pathInUse(path)) return { ok: false, error: path, code: 'in-use' };
    const parts: Uint8Array[] = [];
    let total = 0;
    const options: OpenOptions = { path, baudRate, dataBits: 8, parity: 'None', stopBits: '1' };
    const callbacks: Callbacks = {
      onData: (data) => {
        if (total < 4096) {
          parts.push(data);
          total += data.length;
        }
      },
      onClose: () => undefined,
    };
    let stop!: () => void;
    let finish!: () => void;
    const stopped = new Promise<void>((done) => {
      stop = done;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.samples.set(path, { stop, done });
    let handle: Handle | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      handle = isSimulatedPath(path)
        ? openSimulated(options, callbacks)
        : await openReal(options, callbacks);
      await Promise.race([
        stopped,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
      ]);
    } catch (err) {
      return failure(err);
    } finally {
      clearTimeout(timer);
      await handle
        ?.close()
        .catch((error: unknown) => console.warn('[serial] sample close failed:', error));
      this.samples.delete(path);
      finish();
    }
    const out = new Uint8Array(Math.min(total, 4096));
    let offset = 0;
    for (const p of parts) {
      const take = p.subarray(0, out.length - offset);
      out.set(take, offset);
      offset += take.length;
      if (offset >= out.length) break;
    }
    return { ok: true, value: out };
  }

  async closeAll(): Promise<void> {
    if (this.closingAll) return this.closingAll;
    const samples = [...this.samples.values()];
    for (const sample of samples) sample.stop();
    this.closingAll = (async () => {
      const results = await Promise.allSettled([
        ...[...this.connections.keys()].map((id) => this.close(id)),
        ...samples.map((sample) => sample.done),
      ]);
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason as unknown] : [],
      );
      if (errors.length) throw new AggregateError(errors, 'Could not close all serial ports');
    })();
    try {
      await this.closingAll;
    } finally {
      this.closingAll = null;
    }
  }
}
