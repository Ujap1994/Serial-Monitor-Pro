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
  setError: null as Error | null,
  closeError: null as Error | null,
  holdOpen: false,
  holdDrain: false,
  holdSet: false,
  modem: { cts: true, dsr: false, dcd: true },
}));

vi.mock('serialport', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class SerialPort extends Emitter {
    static list(): Promise<unknown[]> {
      return fake.listError ? Promise.reject(fake.listError) : Promise.resolve(fake.list);
    }
    isOpen = false;
    written: Buffer[] = [];
    sets: Record<string, boolean>[] = [];
    closeCalls = 0;
    finishOpen = (): void => undefined;
    finishSet = (): void => undefined;
    pendingDrain: ((err: Error | null) => void) | null = null;
    constructor(readonly options: { path: string; baudRate: number }) {
      super();
      fake.ports.push(this);
    }
    open(cb: (err: Error | null) => void): void {
      this.finishOpen = () => {
        this.isOpen = !fake.openError;
        cb(fake.openError);
      };
      if (!fake.holdOpen) setImmediate(() => this.finishOpen());
    }
    write(data: Buffer, cb: (err: Error | null) => void): void {
      this.written.push(data);
      setImmediate(() => cb(fake.writeError));
    }
    drain(cb: (err: Error | null) => void): void {
      if (fake.holdDrain) {
        this.pendingDrain = cb;
        return;
      }
      setImmediate(() => cb(fake.drainError));
    }
    set(flags: Record<string, boolean>, cb: (err: Error | null) => void): void {
      this.sets.push(flags);
      this.finishSet = () => cb(fake.setError);
      if (!fake.holdSet) setImmediate(() => this.finishSet());
    }
    get(cb: (err: Error | null, status?: Record<string, boolean>) => void): void {
      setImmediate(() => cb(null, { ...fake.modem, lowLatency: false }));
    }
    close(cb?: (err: Error | null) => void): void {
      this.closeCalls++;
      setImmediate(() => {
        if (fake.closeError) {
          cb?.(fake.closeError);
          return;
        }
        this.isOpen = false;
        this.pendingDrain?.(new Error('Port is not open'));
        this.pendingDrain = null;
        this.emit('close');
        cb?.(null);
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
  options: { path: string; baudRate: number; rtscts?: boolean; xon?: boolean; xoff?: boolean };
  isOpen: boolean;
  written: Buffer[];
  sets: Record<string, boolean>[];
  closeCalls: number;
  finishOpen(): void;
  finishSet(): void;
  pendingDrain: ((err: Error | null) => void) | null;
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
    setError: null,
    closeError: null,
    holdOpen: false,
    holdDrain: false,
    holdSet: false,
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

describe('flow control and control lines (scripted driver)', () => {
  it.each([
    ['none', { rtscts: false, xon: false, xoff: false }],
    ['rtscts', { rtscts: true, xon: false, xoff: false }],
    ['xonxoff', { rtscts: false, xon: true, xoff: true }],
  ] as const)('passes flow control %s to the driver', async (flowControl, expected) => {
    await manager.open('main', { ...opts(PRESENT), flowControl });
    expect(lastPort().options).toMatchObject(expected);
  });

  it('leaves the lines alone when DTR and RTS stay on, as the system sets them', async () => {
    await manager.open('main', opts(PRESENT));
    expect(lastPort().sets).toEqual([]);
  });

  it('applies DTR/RTS right after opening', async () => {
    await manager.open('main', { ...opts(PRESENT), lines: { dtr: false, rts: true } });
    expect(lastPort().sets).toEqual([{ dtr: false, rts: true, brk: false }]);
  });

  it('always sends both lines, because the driver resets missing ones', async () => {
    await manager.open('main', opts(PRESENT));
    expect(await manager.setLines('main', { dtr: true, rts: false })).toEqual({ ok: true });
    expect(await manager.setLines('main', { dtr: false, rts: false })).toEqual({ ok: true });
    expect(lastPort().sets).toEqual([
      { dtr: true, rts: false, brk: false },
      { dtr: false, rts: false, brk: false },
    ]);
  });

  it('reads CTS, DSR and DCD', async () => {
    await manager.open('main', opts(PRESENT));
    expect(await manager.getLines('main')).toEqual({
      ok: true,
      value: { cts: true, dsr: false, dcd: true },
    });
  });

  it('holds the break for the given time and keeps the line state', async () => {
    await manager.open('main', { ...opts(PRESENT), lines: { dtr: false, rts: true } });
    lastPort().sets.length = 0;
    const started = performance.now();
    expect(await manager.sendBreak('main', 60)).toEqual({ ok: true });
    expect(performance.now() - started).toBeGreaterThanOrEqual(55);
    expect(lastPort().sets).toEqual([
      { dtr: false, rts: true, brk: true },
      { dtr: false, rts: true, brk: false },
    ]);
  });

  it('fails opening and releases a driver that refuses requested control lines', async () => {
    fake.setError = new Error('Inappropriate ioctl for device');
    expect(
      await manager.open('main', { ...opts(PRESENT), lines: { dtr: false, rts: false } }),
    ).toMatchObject({
      ok: false,
      error: 'Inappropriate ioctl for device',
    });
    expect(lastPort().isOpen).toBe(false);
    expect(lastPort().closeCalls).toBe(1);
    expect(events).toEqual([]);
    expect(await manager.setLines('main', { dtr: true, rts: true })).toMatchObject({ ok: false });
    fake.setError = null;
    expect(await manager.open('main', opts(PRESENT))).toEqual({ ok: true });
  });

  it('refuses control lines without a connection', async () => {
    expect(await manager.setLines('main', { dtr: true, rts: true })).toMatchObject({ ok: false });
    expect(await manager.getLines('main')).toMatchObject({ ok: false });
    expect(await manager.sendBreak('main', 10)).toMatchObject({ ok: false });
  });
});

describe('port lifecycle races', () => {
  it('does not pretend writes or controls succeed while opening', async () => {
    fake.holdOpen = true;
    const opening = manager.open('main', opts(PRESENT));
    expect(await manager.write('main', Uint8Array.of(1))).toMatchObject({ ok: false });
    expect(await manager.setLines('main', { dtr: false, rts: true })).toMatchObject({ ok: false });
    expect(await manager.getLines('main')).toMatchObject({ ok: false });
    expect(await manager.sendBreak('main', 10)).toMatchObject({ ok: false });
    expect(lastPort().written).toEqual([]);
    lastPort().finishOpen();
    expect(await opening).toEqual({ ok: true });
  });

  it('waits for a pending open to close its actual handle exactly once', async () => {
    fake.holdOpen = true;
    const opening = manager.open('main', opts(PRESENT));
    const closing = manager.close('main');
    const alsoClosing = manager.close('main');
    expect(lastPort().closeCalls).toBe(0);
    lastPort().finishOpen();
    expect(await opening).toMatchObject({ ok: false });
    await Promise.all([closing, alsoClosing]);
    expect(lastPort().isOpen).toBe(false);
    expect(lastPort().closeCalls).toBe(1);
    expect(events.filter((event) => event.kind === 'closed')).toHaveLength(1);
  });

  it('serializes replacement opens without leaking or overwriting a connection', async () => {
    fake.holdOpen = true;
    const first = manager.open('main', opts(PRESENT));
    const old = lastPort();
    const second = manager.open('main', opts(PRESENT));
    const third = manager.open('main', opts(PRESENT));
    fake.holdOpen = false;
    old.finishOpen();
    const results = await Promise.all([first, second, third]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(fake.ports).toHaveLength(2);
    expect(old.isOpen).toBe(false);
    expect(lastPort().isOpen).toBe(true);
    const count = events.length;
    old.emit('data', Buffer.from('late'));
    old.lose();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(events).toHaveLength(count);
    expect(await manager.write('main', Uint8Array.of(2))).toEqual({ ok: true });
  });

  it('close cancels a blocked drain without waiting for the write to finish', async () => {
    await manager.open('main', opts(PRESENT));
    fake.holdDrain = true;
    const writing = manager.write('main', Uint8Array.of(1));
    await expect.poll(() => lastPort().pendingDrain).not.toBeNull();
    await manager.close('main');
    expect(await writing).toMatchObject({ ok: false });
    expect(lastPort().isOpen).toBe(false);
  });

  it('keeps a failed close retryable instead of losing the handle', async () => {
    await manager.open('main', opts(PRESENT));
    fake.closeError = new Error('close failed');
    await expect(manager.close('main')).rejects.toThrow('close failed');
    expect(events).toEqual([]);
    expect(lastPort().isOpen).toBe(true);
    fake.closeError = null;
    await manager.close('main');
    expect(lastPort().isOpen).toBe(false);
  });

  it('reserves a scanner port and cancels its open and wait during shutdown', async () => {
    fake.holdOpen = true;
    const sampling = manager.sample(PRESENT, 9600, 60_000);
    expect(await manager.open('main', opts(PRESENT))).toMatchObject({ ok: false, code: 'in-use' });
    expect(await manager.sample(PRESENT, 9600, 10)).toMatchObject({ ok: false, code: 'in-use' });
    const closing = manager.closeAll();
    expect(await manager.open('mp0', opts('another-port'))).toMatchObject({ ok: false });
    lastPort().finishOpen();
    await closing;
    await sampling;
    expect(lastPort().isOpen).toBe(false);
    expect(lastPort().closeCalls).toBe(1);
  });

  it('does not announce success if the driver closes during initial line setup', async () => {
    fake.holdSet = true;
    const opening = manager.open('main', { ...opts(PRESENT), lines: { dtr: false, rts: false } });
    await expect.poll(() => lastPort().sets.length).toBe(1);
    lastPort().lose();
    expect(await opening).toMatchObject({ ok: false });
    lastPort().finishSet();
    expect(await manager.write('main', Uint8Array.of(1))).toMatchObject({ ok: false });
  });
});

describe('control safety', () => {
  it.each([
    { dtr: false, rts: true },
    { dtr: true, rts: false },
  ])('refuses initial manual lines with hardware flow control: %j', async (lines) => {
    expect(
      await manager.open('main', { ...opts(PRESENT), flowControl: 'rtscts', lines }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('RTS/CTS'),
    });
    expect(fake.ports).toEqual([]);
  });

  it('never calls set for DTR, RTS or BREAK when hardware flow control owns RTS', async () => {
    await manager.open('main', { ...opts(PRESENT), flowControl: 'rtscts' });
    expect(await manager.setLines('main', { dtr: false, rts: true })).toMatchObject({ ok: false });
    expect(await manager.sendBreak('main', 10)).toMatchObject({ ok: false });
    expect(lastPort().sets).toEqual([]);
    expect(await manager.getLines('main')).toMatchObject({ ok: true });
  });

  it('preserves the last successful line state after a failed change', async () => {
    await manager.open('main', opts(PRESENT));
    fake.setError = new Error('set failed');
    expect(await manager.setLines('main', { dtr: false, rts: false })).toMatchObject({ ok: false });
    fake.setError = null;
    expect(await manager.sendBreak('main', 1)).toEqual({ ok: true });
    expect(lastPort().sets.slice(-2)).toEqual([
      { dtr: true, rts: true, brk: true },
      { dtr: true, rts: true, brk: false },
    ]);
  });

  it('does not let a line change or overlapping BREAK shorten a pulse', async () => {
    await manager.open('main', opts(PRESENT));
    const pulse = manager.sendBreak('main', 60);
    const change = manager.setLines('main', { dtr: false, rts: false });
    const nextPulse = manager.sendBreak('main', 10);
    await expect.poll(() => lastPort().sets.length, { interval: 1 }).toBe(1);
    expect(lastPort().sets[0]).toMatchObject({ brk: true });
    await Promise.all([pulse, change, nextPulse]);
    expect(lastPort().sets).toEqual([
      { dtr: true, rts: true, brk: true },
      { dtr: true, rts: true, brk: false },
      { dtr: false, rts: false, brk: false },
      { dtr: false, rts: false, brk: true },
      { dtr: false, rts: false, brk: false },
    ]);
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
