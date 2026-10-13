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
