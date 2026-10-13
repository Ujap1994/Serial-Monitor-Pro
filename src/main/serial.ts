// Serial port management in the main process.
//
// Each connection has an id ("main" for the monitor, "mp0" … "mp3" for the
// multi-port view). Received data is collected for a few milliseconds and
// sent to the renderer in batches – at high baud rates this keeps IPC traffic
// low without losing the exact receive time of each chunk.

import { readdir, readFile, readlink } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SerialPort } from 'serialport';
import type {
  Chunk,
  Failure,
  OpenOptions,
  PortInfo,
  Result,
  SerialErrorCode,
  SerialEvent,
  ValueResult,
} from '@shared/ipc';
import { isSimulatedPath, SimulatedDevice, simulatedPorts } from './simulator';

const BATCH_MS = 8;
const PARITY = { None: 'none', Even: 'even', Odd: 'odd', Mark: 'mark', Space: 'space' } as const;

interface Handle {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface Connection {
  path: string;
  handle: Handle;
  pending: Chunk[];
  timer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  /** The renderer has been told that this connection ended. */
  ended: boolean;
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

const now = (): number => performance.timeOrigin + performance.now();

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
  const device = new SimulatedDevice(options.path, options.baudRate, {
    onData: (data) => cb.onData(data),
  });
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
  };
}

function openReal(options: OpenOptions, cb: Callbacks): Promise<Handle> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      dataBits: options.dataBits,
      parity: PARITY[options.parity],
      stopBits: Number(options.stopBits) as 1 | 1.5 | 2,
      autoOpen: false,
    });
    let intentional = false;
    port.on('data', (data: Buffer) => cb.onData(new Uint8Array(data)));
    port.on('error', (err: Error) => console.warn(`[serial] ${options.path}:`, err.message));
    port.on('close', (err?: Error & { disconnected?: boolean }) => {
      cb.onClose(!intentional, err?.message);
    });
    port.open((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        write: (data) =>
          new Promise<void>((done, fail) => {
            port.write(Buffer.from(data), (writeErr) => {
              if (writeErr) return fail(writeErr);
              port.drain((drainErr) => (drainErr ? fail(drainErr) : done()));
            });
          }),
        close: () =>
          new Promise<void>((done) => {
            intentional = true;
            if (!port.isOpen) return done();
            port.close(() => done());
          }),
      });
    });
  });
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class SerialManager {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly emit: (event: SerialEvent) => void) {}

  private pathInUse(path: string, exceptId?: string): boolean {
    for (const [id, conn] of this.connections) {
      if (id !== exceptId && conn.path === path) return true;
    }
    return false;
  }

  async open(id: string, options: OpenOptions): Promise<Result> {
    if (this.connections.has(id)) await this.close(id);
    if (this.pathInUse(options.path, id)) {
      return { ok: false, error: options.path, code: 'in-use' };
    }

    // Reserve the id before the asynchronous open so a quick second request
    // cannot open the same port twice.
    const conn: Connection = {
      path: options.path,
      handle: { write: () => Promise.resolve(), close: () => Promise.resolve() },
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
      return { ok: true };
    } catch (err) {
      if (this.connections.get(id) === conn) this.connections.delete(id);
      return failure(err);
    }
  }

  private received(id: string, conn: Connection, data: Uint8Array): void {
    if (!data.length) return;
    conn.pending.push({ t: now(), data });
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
    this.emit({ kind: 'closed', id, path: conn.path, lost: lost && !conn.closing, error });
  }

  async close(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;
    conn.closing = true;
    this.flush(id, conn);
    try {
      await conn.handle.close();
    } catch (err) {
      console.warn('[serial] close failed:', err);
    }
    this.closed(id, conn, false);
  }

  async write(id: string, data: Uint8Array): Promise<Result> {
    const conn = this.connections.get(id);
    if (!conn || conn.closing) return { ok: false, error: 'not connected', code: 'unknown' };
    try {
      await conn.handle.write(data);
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  }

  /** Listens on a port for `ms` milliseconds (baud rate scanner). */
  async sample(path: string, baudRate: number, ms: number): Promise<ValueResult<Uint8Array>> {
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
    let handle: Handle;
    try {
      handle = isSimulatedPath(path)
        ? openSimulated(options, callbacks)
        : await openReal(options, callbacks);
    } catch (err) {
      return failure(err);
    }
    await new Promise((r) => setTimeout(r, ms));
    await handle.close().catch(() => undefined);
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
    await Promise.all([...this.connections.keys()].map((id) => this.close(id)));
  }
}
