import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '../../src/main/storage';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'smp-store-'));
  process.env.SMP_NO_LEGACY_IMPORT = '1';
});

describe('Storage', () => {
  it('saves and loads JSON', async () => {
    const store = new Storage(dir);
    expect(await store.save('commands', [{ name: 'A' }])).toBe(true);
    expect(await store.load('commands')).toEqual([{ name: 'A' }]);
  });

  it('leaves no temporary files behind', async () => {
    const store = new Storage(dir);
    await store.save('settings', { baud: 9600 });
    expect(readdirSync(dir)).toEqual(['settings.json']);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ baud: 9600 });
  });

  it('returns null for missing or damaged files', async () => {
    const store = new Storage(dir);
    expect(await store.load('automation')).toBeNull();
    writeFileSync(join(dir, 'automation.json'), '{ broken');
    expect(await store.load('automation')).toBeNull();
  });
});

describe('data folder chosen by the user', () => {
  it('keeps the settings in the application folder and moves commands and automation', async () => {
    const store = new Storage(dir);
    await store.save('commands', [{ name: 'here' }]);
    await store.save('automation', [{ kind: 'log' }]);
    const target = mkdtempSync(join(tmpdir(), 'smp-data-'));
    expect(await store.setDataDir(target)).toBe(true);
    expect(store.customDataDir).toBe(target);
    expect(store.path('settings')).toBe(join(dir, 'settings.json'));
    expect(store.path('commands')).toBe(join(target, 'commands.json'));
    // Missing files are copied, so nothing is lost by the move.
    expect(await store.load('commands')).toEqual([{ name: 'here' }]);
    expect(await store.load('automation')).toEqual([{ kind: 'log' }]);
  });

  it('uses files that already exist in the new folder instead of overwriting them', async () => {
    const store = new Storage(dir);
    await store.save('commands', [{ name: 'local' }]);
    const shared = mkdtempSync(join(tmpdir(), 'smp-shared-'));
    writeFileSync(join(shared, 'commands.json'), JSON.stringify([{ name: 'team' }]));
    expect(await store.setDataDir(shared)).toBe(true);
    expect(await store.load('commands')).toEqual([{ name: 'team' }]);
    // Back to the default folder: the local file is still there.
    expect(await store.setDataDir('')).toBe(true);
    expect(await store.load('commands')).toEqual([{ name: 'local' }]);
  });

  it('rejects relative or missing folders and keeps the current one', async () => {
    const store = new Storage(dir);
    expect(await store.setDataDir('relative/folder')).toBe(false);
    expect(await store.setDataDir(join(dir, 'does-not-exist'))).toBe(false);
    const file = join(dir, 'a-file');
    writeFileSync(file, '');
    expect(await store.setDataDir(file)).toBe(false);
    expect(store.customDataDir).toBe('');
  });
});
