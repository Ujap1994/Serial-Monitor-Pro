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
