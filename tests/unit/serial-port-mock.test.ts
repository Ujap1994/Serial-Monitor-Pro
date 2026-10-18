// The real-port code path of SerialManager against a scripted stand-in for the
// serialport package. Unlike the socat tests this runs on every platform –
// including Windows – and can trigger failures that real devices rarely show
// on demand (a driver refusing to drain, a port vanishing mid-write …).

import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialEvent } from '@shared/ipc';

const fake = vi.hoisted(() => ({
  ports: [] as unknown[],
  list: [] as unknown[],
  listError: null as Error | null,
  openError: null as Error | null,
  writeError: null as Error | null,
  drainError: null as Error | null,
}));

vi.mock('serialport', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class SerialPort extends Emitter {
    static list(): Promise<unknown[]> {
      return fake.listError ? Promise.reject(fake.listError) : Promise.resolve(fake.list);
    }
    isOpen = false;
    written: Buffer[] = [];
    constructor(readonly options: { path: string; baudRate: number }) {
      super();
      fake.ports.push(this);
    }
    open(cb: (err: Error | null) => void): void {
      this.isOpen = !fake.openError;
      setImmediate(() => cb(fake.openError));
    }
    write(data: Buffer, cb: (err: Error | null) => void): void {
      this.written.push(data);
      setImmediate(() => cb(fake.writeError));
    }
    drain(cb: (err: Error | null) => void): void {
      setImmediate(() => cb(fake.drainError));
    }
    close(cb?: (err: Error | null) => void): void {
      this.isOpen = false;
      setImmediate(() => {
        cb?.(null);
        this.emit('close');
      });
    }
    /** Test helper: the driver reports that the device is gone. */
    lose(): void {
      this.isOpen = false;
      this.emit('close', Object.assign(new Error('device disconnected'), { disconnected: true }));
    }
  }
  return { SerialPort };
});

const { listPorts, SerialManager } = await import('../../src/main/serial');

type FakePort = EventEmitter & {
  options: { path: string; baudRate: number };
  isOpen: boolean;
  written: Buffer[];
  lose(): void;
};
const lastPort = (): FakePort => fake.ports[fake.ports.length - 1] as FakePort;
const opts = (path: string) =>
  ({ path, baudRate: 115200, dataBits: 8, parity: 'Even', stopBits: '2' }) as const;
// A path that exists on every system, so the presence check keeps quiet.
const PRESENT = process.cwd();

let events: SerialEvent[];
let manager: InstanceType<typeof SerialManager>;

beforeEach(() => {
  Object.assign(fake, {
    ports: [],
    list: [],
    listError: null,
    openError: null,
    writeError: null,
    drainError: null,
  });
  events = [];
  manager = new SerialManager((e) => events.push(e));
});
afterEach(async () => {
  await manager.closeAll();
  vi.useRealTimers();
});

describe('SerialManager on a real port (scripted driver)', () => {
  it('passes the line settings to the driver and forwards data in batches', async () => {
    expect(await manager.open('main', opts(PRESENT))).toEqual({ ok: true });
    expect(lastPort().options).toMatchObject({ baudRate: 115200, parity: 'even', stopBits: 2 });
    lastPort().emit('data', Buffer.from('ab'));
    lastPort().emit('data', Buffer.from('cd'));
    await expect.poll(() => events.filter((e) => e.kind === 'data')).toHaveLength(1);
    const data = events.find((e) => e.kind === 'data');
    expect(data?.kind === 'data' && data.chunks.map((c) => Buffer.from(c.data).toString())).toEqual(
      ['ab', 'cd'],
    );
  });

  it('writes and waits for the driver to drain', async () => {
    await manager.open('main', opts(PRESENT));
    expect(await manager.write('main', Uint8Array.of(1, 2, 3))).toEqual({ ok: true });
    expect(lastPort().written.map((b) => [...b])).toEqual([[1, 2, 3]]);
  });

  it.each([
    ['Error: Access denied', 'permission'],
    ['Error: Resource temporarily unavailable Cannot lock port', 'busy'],
    ['Error: No such file or directory, cannot open /dev/ttyUSB7', 'not-found'],
  ])('explains a failed open: %s', async (message, code) => {
    fake.openError = new Error(message);
    expect(await manager.open('main', opts(PRESENT))).toMatchObject({ ok: false, code });
    // The id is free again – a second attempt is not refused as "in use".
    fake.openError = null;
    expect(await manager.open('main', opts(PRESENT))).toEqual({ ok: true });
  });

  it('reports write and drain errors instead of throwing', async () => {
    await manager.open('main', opts(PRESENT));
    fake.writeError = new Error('Access denied');
    expect(await manager.write('main', Uint8Array.of(1))).toMatchObject({
      ok: false,
      code: 'permission',
    });
    fake.writeError = null;
    fake.drainError = new Error('drain failed');
    expect(await manager.write('main', Uint8Array.of(1))).toMatchObject({ ok: false });
  });

  it('reports an unplugged device as lost, exactly once', async () => {
    await manager.open('main', opts(PRESENT));
    lastPort().lose();
    lastPort().lose();
    expect(events.filter((e) => e.kind === 'closed')).toEqual([
      { kind: 'closed', id: 'main', path: PRESENT, lost: true, error: 'device disconnected' },
    ]);
    expect(await manager.write('main', Uint8Array.of(1))).toMatchObject({ ok: false });
  });

  it('reports a deliberate close as not lost', async () => {
    await manager.open('main', opts(PRESENT));
    await manager.close('main');
    await new Promise((r) => setImmediate(r));
    expect(events.filter((e) => e.kind === 'closed')).toEqual([
      { kind: 'closed', id: 'main', path: PRESENT, lost: false },
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'notices a device node that disappears without the driver saying so',
    async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      await manager.open('main', opts('/dev/smp-test-device-that-does-not-exist'));
      expect(events.some((e) => e.kind === 'closed')).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      await expect
        .poll(() => events.find((e) => e.kind === 'closed'))
        .toMatchObject({ kind: 'closed', lost: true });
    },
  );

  it('keeps an open port alone as long as its device node exists', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await manager.open('main', opts(PRESENT));
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.some((e) => e.kind === 'closed')).toBe(false);
    expect(lastPort().isOpen).toBe(true);
  });

  it('samples a port for the baud rate scanner and keeps at most 4 KiB', async () => {
    const pending = manager.sample(PRESENT, 9600, 50);
    await vi.waitFor(() => expect(lastPort()?.isOpen).toBe(true));
    lastPort().emit('data', Buffer.alloc(3000, 0x41));
    lastPort().emit('data', Buffer.alloc(3000, 0x42));
    const result = await pending;
    expect(result.ok && result.value.length).toBe(4096);
    expect(result.ok && result.value[4095]).toBe(0x42);
    expect(lastPort().isOpen).toBe(false);
  });

  it('does not sample a port that is open in the monitor', async () => {
    await manager.open('main', opts(PRESENT));
    expect(await manager.sample(PRESENT, 9600, 10)).toMatchObject({ ok: false, code: 'in-use' });
  });

  it('explains when sampling cannot open the port', async () => {
    fake.openError = new Error('Access denied');
    expect(await manager.sample(PRESENT, 9600, 10)).toMatchObject({
      ok: false,
      code: 'permission',
    });
  });
});

describe('listPorts', () => {
  it('describes ports by friendly name or vendor and sorts them naturally', async () => {
    fake.list = [
      { path: 'COM10', friendlyName: 'USB-SERIAL CH340 (COM10)' },
      { path: 'COM3', manufacturer: 'FTDI', vendorId: '0403', productId: '6001' },
      { path: 'COM4' },
    ];
    expect(await listPorts(false)).toEqual([
      expect.objectContaining({ path: 'COM3', description: 'FTDI · 0403:6001' }),
      expect.objectContaining({ path: 'COM4', description: '' }),
      expect.objectContaining({ path: 'COM10', description: 'USB-SERIAL CH340' }),
    ]);
  });

  it.skipIf(process.platform === 'linux')('survives a failing port listing', async () => {
    fake.listError = new Error('enumeration failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await listPorts(false)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
