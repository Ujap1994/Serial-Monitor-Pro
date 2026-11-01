// JSON storage for settings, commands and automation sequences.
//
// Files live in Electron's userData directory. Writes are atomic (temporary
// file + rename), so a crash while saving never leaves a half-written file.
// On first start, data of the former Python version (~/.serial_monitor_pro)
// is taken over automatically.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
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

const LEGACY_CTK_SETTINGS = 'serial_monitor_settings.json';
const LEGACY_CTK_PRESETS = 'serial_presets.json';

async function readLegacy(name: string): Promise<unknown> {
  const file = join(LEGACY_DIR, name);
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as unknown;
    console.info(`[storage] imported ${file}`);
    return data;
  } catch {
    return null;
  }
}

/**
 * Presets of the CustomTkinter version: "serial_presets.json" in its own
 * "presets_path" (from serial_monitor_settings.json) or in its data folder.
 */
async function readLegacyCtkPresets(): Promise<unknown> {
  const settings = asObject(await readLegacy(LEGACY_CTK_SETTINGS));
  const custom = typeof settings.presets_path === 'string' ? settings.presets_path.trim() : '';
  if (custom) {
    const file = join(custom, LEGACY_CTK_PRESETS);
    try {
      const data = JSON.parse(await readFile(file, 'utf8')) as unknown;
      console.info(`[storage] imported ${file}`);
      return data;
    } catch {
      // fall back to the default folder
    }
  }
  return readLegacy(LEGACY_CTK_PRESETS);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** True for '' (default) and for an absolute path of an existing folder. */
export async function isUsableFolder(dir: string): Promise<boolean> {
  if (!dir) return true;
  if (!isAbsolute(dir)) return false;
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

export class Storage {
  /** Folder for commands and automation chosen by the user ('' = application folder). */
  private dataDir = '';

  constructor(private readonly dir: string) {}

  path(name: StoreName): string {
    // The settings always stay in the application folder – they say where the rest is.
    return join(name === 'settings' ? this.dir : this.dataDir || this.dir, FILES[name]);
  }

  get customDataDir(): string {
    return this.dataDir;
  }

  /**
   * Moves commands and automation to another folder ("Preset save path" of the
   * Python version). Files already present in the new folder are used as they
   * are; missing ones are copied from the current folder. Returns false (and
   * keeps the current folder) when the folder cannot be used.
   */
  async setDataDir(dir: string): Promise<boolean> {
    const target = dir.trim();
    if (target === this.dataDir) return true;
    if (!(await isUsableFolder(target))) return false;
    const names: StoreName[] = ['commands', 'automation'];
    try {
      for (const name of names) {
        const from = this.path(name);
        const to = join(target || this.dir, FILES[name]);
        if (from !== to && existsSync(from) && !existsSync(to)) {
          await mkdir(dirname(to), { recursive: true });
          await copyFile(from, to);
        }
      }
    } catch (err) {
      console.warn('[storage] could not copy data to the new folder:', err);
      return false;
    }
    this.dataDir = target;
    return true;
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
    const data = await readLegacy(LEGACY_FILES[name]);
    if (name === 'commands') return data ?? (await readLegacyCtkPresets());
    if (name !== 'settings') return data;
    // The CustomTkinter version kept transmit options (CRC, header/footer,
    // periodic sending) in its own file; the PySide version's file wins on overlap.
    const older = await readLegacy(LEGACY_CTK_SETTINGS);
    if (data === null && older === null) return null;
    return migrateLegacySettings({ ...asObject(older), ...asObject(data) });
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
