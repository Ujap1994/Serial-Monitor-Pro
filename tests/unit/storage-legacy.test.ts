// Takeover of the data of the former Python version (~/.serial_monitor_pro).
// The home directory is redirected to a temporary folder – the test must never
// read the real one of whoever runs it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as OsModule from 'node:os';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof OsModule>();
  const path = await import('node:path');
  return { ...os, homedir: () => path.join(os.tmpdir(), `smp-legacy-home-${process.pid}`) };
});

const { Storage } = await import('../../src/main/storage');

const home = join(tmpdir(), `smp-legacy-home-${process.pid}`);
const legacy = join(home, '.serial_monitor_pro');
let store: InstanceType<typeof Storage>;

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(legacy, { recursive: true });
  store = new Storage(mkdtempSync(join(tmpdir(), 'smp-store-')));
  delete process.env.SMP_NO_LEGACY_IMPORT;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.SMP_NO_LEGACY_IMPORT = '1';
});

describe('import of the former Python version', () => {
  it('uses the redirected home directory', () => {
    expect(homedir()).toBe(home);
  });

  it('takes over settings and converts them', async () => {
    writeFileSync(
      join(legacy, 'settings.json'),
      JSON.stringify({ port: 'COM7', baud: 57600, bytesize: 7, auto_reconnect: true }),
    );
    expect(await store.load('settings')).toMatchObject({
      port: 'COM7',
      baud: 57600,
      dataBits: 7,
      autoReconnect: true,
    });
  });

  it('takes over presets as commands and automation as it is', async () => {
    writeFileSync(join(legacy, 'presets.json'), JSON.stringify([{ name: 'Ping' }]));
    writeFileSync(join(legacy, 'automation.json'), JSON.stringify([{ type: 'note' }]));
    expect(await store.load('commands')).toEqual([{ name: 'Ping' }]);
    expect(await store.load('automation')).toEqual([{ type: 'note' }]);
  });

  it('prefers the own file once it exists', async () => {
    writeFileSync(join(legacy, 'presets.json'), JSON.stringify([{ name: 'old' }]));
    await store.save('commands', [{ name: 'new' }]);
    expect(await store.load('commands')).toEqual([{ name: 'new' }]);
  });

  it('ignores damaged legacy files and can be switched off', async () => {
    writeFileSync(join(legacy, 'presets.json'), '{ broken');
    expect(await store.load('commands')).toBeNull();
    writeFileSync(join(legacy, 'automation.json'), '[]');
    process.env.SMP_NO_LEGACY_IMPORT = '1';
    expect(await store.load('automation')).toBeNull();
  });
});

describe('saving', () => {
  it('reports a folder it cannot write to instead of throwing', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'smp-store-')), 'not-a-folder');
    writeFileSync(file, '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await new Storage(file).save('settings', {})).toBe(false);
  });
});
