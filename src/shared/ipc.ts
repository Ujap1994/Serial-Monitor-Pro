// Contract between the main process and the renderer.
// The preload script exposes exactly this API as `window.smp`.

import type { DataBits, Parity, StopBits, Theme } from './core/settings';
import type { Language } from './i18n';

export interface PortInfo {
  path: string;
  /** Human readable description, e.g. "USB-SERIAL CH340" */
  description: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  simulated?: boolean;
}

export interface OpenOptions {
  path: string;
  baudRate: number;
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
}

export type SerialErrorCode = 'permission' | 'not-found' | 'busy' | 'in-use' | 'unknown';

export interface Failure {
  ok: false;
  error: string;
  code: SerialErrorCode;
}
export type Result = { ok: true } | Failure;
export type ValueResult<T> = { ok: true; value: T } | Failure;

export interface Chunk {
  /** Epoch milliseconds (fractional, high resolution). */
  t: number;
  data: Uint8Array;
}

export type SerialEvent =
  | { kind: 'data'; id: string; chunks: Chunk[] }
  | { kind: 'closed'; id: string; path: string; lost: boolean; error?: string };

export type StoreName = 'settings' | 'commands' | 'automation';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  locale: string;
  /** Simulator forced on via --simulator / SMP_SIMULATOR=1 */
  simulatorForced: boolean;
  paths: { userData: string; settings: string; commands: string; automation: string };
  /** Linux group that grants access to serial ports (dialout, uucp …). */
  serialGroup: string | null;
  repository: string;
}

export type MenuAction =
  | 'export-txt'
  | 'export-csv'
  | 'settings'
  | 'about'
  | 'shortcuts'
  | 'clear'
  | 'toggle-connection'
  | 'refresh-ports'
  | 'baud-scan'
  | 'import-commands'
  | 'export-commands'
  | `theme:${Theme}`;

export interface SmpApi {
  serial: {
    list(includeSimulated: boolean): Promise<PortInfo[]>;
    open(id: string, options: OpenOptions): Promise<Result>;
    close(id: string): Promise<void>;
    write(id: string, data: Uint8Array): Promise<Result>;
    /** Opens the port briefly and returns what arrived (baud rate scanner). */
    sample(path: string, baudRate: number, ms: number): Promise<ValueResult<Uint8Array>>;
    onEvent(listener: (event: SerialEvent) => void): () => void;
  };
  store: {
    load(name: StoreName): Promise<unknown>;
    save(name: StoreName, data: unknown): Promise<boolean>;
  };
  files: {
    saveText(defaultName: string, content: string, filters: FileFilter[]): Promise<string | null>;
    openText(filters: FileFilter[]): Promise<{ path: string; content: string } | null>;
  };
  log: {
    start(defaultName: string): Promise<string | null>;
    write(text: string): void;
    stop(): Promise<void>;
  };
  app: {
    info(): Promise<AppInfo>;
    setTheme(theme: Theme): void;
    setLanguage(language: Language): void;
    openExternal(url: string): Promise<void>;
    onMenu(listener: (action: MenuAction) => void): () => void;
  };
}

export const IPC = {
  serialList: 'serial:list',
  serialOpen: 'serial:open',
  serialClose: 'serial:close',
  serialWrite: 'serial:write',
  serialSample: 'serial:sample',
  serialEvent: 'serial:event',
  storeLoad: 'store:load',
  storeSave: 'store:save',
  fileSave: 'file:save',
  fileOpen: 'file:open',
  logStart: 'log:start',
  logWrite: 'log:write',
  logStop: 'log:stop',
  appInfo: 'app:info',
  appTheme: 'app:theme',
  appLanguage: 'app:language',
  appExternal: 'app:external',
  appMenu: 'app:menu',
} as const;
