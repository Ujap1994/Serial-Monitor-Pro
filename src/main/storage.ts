// JSON storage for settings, commands and automation sequences.
//
// Files live in Electron's userData directory. Writes are atomic (temporary
// file + rename), so a crash while saving never leaves a half-written file.
// On first start, data of the former Python version (~/.serial_monitor_pro)
// is taken over automatically.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { migrateLegacySettings } from '@shared/core/settings';
import type { StoreName } from '@shared/ipc';

const FILES: Record<StoreName, string> = {
  settings: 'settings.json',
  commands: 'commands.json',
  automation: 'automation.json',
};

const LEGACY_DIR = join(homedir(), '.serial_monitor_pro');
const LEGACY_FILES: Record<StoreName, string> = {
  settings: 'settings.json',
  commands: 'presets.json',
  automation: 'automation.json',
};

export class Storage {
  constructor(private readonly dir: string) {}

  path(name: StoreName): string {
    return join(this.dir, FILES[name]);
  }

  async load(name: StoreName): Promise<unknown> {
    const file = this.path(name);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch (err) {
      if (existsSync(file)) {
        console.warn(`[storage] ${file} is unreadable – using defaults:`, err);
        return null;
      }
    }
    return this.loadLegacy(name);
  }

  private async loadLegacy(name: StoreName): Promise<unknown> {
    if (process.env.SMP_NO_LEGACY_IMPORT) return null;
    const file = join(LEGACY_DIR, LEGACY_FILES[name]);
    try {
      const data = JSON.parse(await readFile(file, 'utf8')) as unknown;
      console.info(`[storage] imported ${file}`);
      return name === 'settings' ? migrateLegacySettings(data) : data;
    } catch {
      return null;
    }
  }

  async save(name: StoreName, data: unknown): Promise<boolean> {
    const file = this.path(name);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await rename(tmp, file);
      return true;
    } catch (err) {
      console.warn(`[storage] could not write ${file}:`, err);
      return false;
    }
  }
}
