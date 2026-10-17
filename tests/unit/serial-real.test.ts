// Exercises the real serialport code path against a virtual TTY created by
// socat (Linux/macOS). Skipped automatically when socat is not installed.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SerialEvent } from '@shared/ipc';
import { SerialManager } from '../../src/main/serial';

const hasSocat =
  process.platform !== 'win32' && spawnSync('which', ['socat'], { stdio: 'ignore' }).status === 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function echoDevice(): Promise<{ path: string; proc: ChildProcess }> {
  const path = join(mkdtempSync(join(tmpdir(), 'smp-tty-')), 'tty');
  const proc = spawn('socat', [`PTY,link=${path},raw,echo=0`, 'EXEC:cat'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !existsSync(path); i++) await sleep(20);
  return { path, proc };
}

let device: { path: string; proc: ChildProcess } | null = null;
let manager: SerialManager | null = null;

afterEach(async () => {
  await manager?.closeAll();
  device?.proc.kill();
  manager = null;
  device = null;
});

describe.skipIf(!hasSocat)('SerialManager with a real (virtual) TTY', () => {
  it('opens, writes, reads and closes', async () => {
    device = await echoDevice();
    const events: SerialEvent[] = [];
    manager = new SerialManager((e) => events.push(e));
    const result = await manager.open('main', {
      path: device.path,
      baudRate: 115200,
      dataBits: 8,
      parity: 'None',
      stopBits: '1',
    });
    expect(result).toEqual({ ok: true });
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(await manager.write('main', payload)).toEqual({ ok: true });
    await expect
      .poll(() =>
        events.flatMap((e) =>
          e.kind === 'data' ? e.chunks.flatMap((c) => Array.from(c.data)) : [],
        ),
      )
      .toEqual(Array.from(payload));
    await manager.close('main');
    expect(events.filter((e) => e.kind === 'closed')).toEqual([
      { kind: 'closed', id: 'main', path: device.path, lost: false },
    ]);
  });

  it('reports a lost connection when the device disappears', async () => {
    device = await echoDevice();
    const events: SerialEvent[] = [];
    manager = new SerialManager((e) => events.push(e));
    await manager.open('main', {
      path: device.path,
      baudRate: 9600,
      dataBits: 8,
      parity: 'None',
      stopBits: '1',
    });
    device.proc.kill();
    await expect
      .poll(() => events.find((e) => e.kind === 'closed'), { timeout: 5000 })
      .toMatchObject({ kind: 'closed', id: 'main', lost: true });
  });

  it('explains a missing device', async () => {
    manager = new SerialManager(() => undefined);
    const result = await manager.open('main', {
      path: '/dev/does-not-exist-smp',
      baudRate: 9600,
      dataBits: 8,
      parity: 'None',
      stopBits: '1',
    });
    expect(result).toMatchObject({ ok: false, code: 'not-found' });
  });
});

describe.skipIf(!hasSocat)('SerialManager under load and in error cases (virtual TTY)', () => {
  const opts = (path: string) =>
    ({ path, baudRate: 115200, dataBits: 8, parity: 'None', stopBits: '1' }) as const;

  const receivedBytes = (events: SerialEvent[]): number[] =>
    events.flatMap((e) => (e.kind === 'data' ? e.chunks.flatMap((c) => Array.from(c.data)) : []));

  it('echoes 256 KiB byte for byte and in order', async () => {
    device = await echoDevice();
    const events: SerialEvent[] = [];
    let count = 0;
    manager = new SerialManager((e) => {
      events.push(e);
      if (e.kind === 'data') for (const c of e.chunks) count += c.data.length;
    });
    expect(await manager.open('main', opts(device.path))).toEqual({ ok: true });
    const payload = Uint8Array.from({ length: 256 * 1024 }, (_, i) => (i * 7919 + (i >> 8)) & 0xff);
    // Block by block, each one echoed before the next – like a protocol with
    // acknowledgements. A virtual TTY on macOS drops input once its small queue
    // is full (measured: a reader stalled for 300 ms lost more than half), so a
    // free-running stream would only test the PTY under load, not the app.
    const block = 1024;
    for (let off = 0; off < payload.length; off += block) {
      expect(await manager.write('main', payload.subarray(off, off + block))).toEqual({ ok: true });
      await expect.poll(() => count, { interval: 1, timeout: 5000 }).toBe(off + block);
    }
    expect(Buffer.from(receivedBytes(events)).equals(Buffer.from(payload))).toBe(true);
    const times = events.flatMap((e) => (e.kind === 'data' ? e.chunks.map((c) => c.t) : []));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  }, 30_000);

  it('reports a port that another program holds as busy', async () => {
    device = await echoDevice();
    manager = new SerialManager(() => undefined);
    const other = new SerialManager(() => undefined);
    expect(await other.open('main', opts(device.path))).toEqual({ ok: true });
    try {
      expect(await manager.open('main', opts(device.path))).toMatchObject({
        ok: false,
        code: 'busy',
      });
    } finally {
      await other.closeAll();
    }
  });

  it('refuses to write after the device disappeared', async () => {
    device = await echoDevice();
    const events: SerialEvent[] = [];
    manager = new SerialManager((e) => events.push(e));
    await manager.open('main', opts(device.path));
    device.proc.kill();
    await expect.poll(() => events.some((e) => e.kind === 'closed'), { timeout: 5000 }).toBe(true);
    expect(await manager.write('main', Uint8Array.of(1, 2, 3))).toMatchObject({ ok: false });
  });

  it('opens the same port again after closing it', async () => {
    device = await echoDevice();
    const events: SerialEvent[] = [];
    manager = new SerialManager((e) => events.push(e));
    for (const word of ['first', 'second', 'third']) {
      events.length = 0;
      expect(await manager.open('main', opts(device.path))).toEqual({ ok: true });
      await manager.write('main', new TextEncoder().encode(word));
      await expect.poll(() => Buffer.from(receivedBytes(events)).toString()).toBe(word);
      await manager.close('main');
    }
  });

  it('samples a talking device for the baud rate scanner', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'smp-tty-')), 'tty');
    const proc = spawn(
      'socat',
      [`PTY,link=${path},raw,echo=0`, 'SYSTEM:while true; do echo hello; sleep 0.02; done'],
      { stdio: 'ignore' },
    );
    device = { path, proc };
    for (let i = 0; i < 100 && !existsSync(path); i++) await sleep(20);
    manager = new SerialManager(() => undefined);
    const result = await manager.sample(path, 9600, 400);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.length).toBeLessThanOrEqual(4096);
    expect(Buffer.from(result.value).toString()).toContain('hello');
  });
});
