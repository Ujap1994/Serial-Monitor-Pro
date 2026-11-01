// Contract between the main process and the renderer.
// The preload script exposes exactly this API as `window.smp`.

import type { CapturePort, CaptureSummary } from './core/capture';
import type { ReplayOptions } from './core/replay';
import type { DataBits, FlowControl, Parity, StopBits, Theme } from './core/settings';
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
  /** Default: none. */
  flowControl?: FlowControl;
  /** State of DTR and RTS after opening. Default: both on. */
  lines?: ControlLines;
}

/** Outputs of the port. */
export interface ControlLines {
  dtr: boolean;
  rts: boolean;
}

/** Inputs of the port, set by the device. */
export interface ModemLines {
  cts: boolean;
  dsr: boolean;
  dcd: boolean;
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

/** Result of a session capture. */
export interface CaptureStats {
  path: string;
  durationMs: number;
  rxBytes: number;
  txBytes: number;
  events: number;
  /** Set when the file could not be written completely. */
  error: string | null;
}

/** A capture loaded as a simulated device. */
export interface ReplayInfo {
  /** Port path of the simulated device, e.g. "sim:replay-1". */
  path: string;
  /** File name of the capture. */
  name: string;
  options: ReplayOptions;
  summary: CaptureSummary;
  port?: CapturePort;
}

export type StoreName = 'settings' | 'commands' | 'automation';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface BinaryFile {
  path: string;
  name: string;
  data: Uint8Array;
}

/** A published release, as far as the update notice needs it. */
export interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  /** ISO date of publication. */
  date: string;
  /** Release notes (Markdown). */
  body: string;
  draft: boolean;
  prerelease: boolean;
}

export interface StoragePaths {
  userData: string;
  settings: string;
  commands: string;
  automation: string;
  /** Default folder of save dialogs and stop captures. */
  logs: string;
}

/** Folders chosen in the settings ('' = default). */
export interface FolderSettings {
  dataDir: string;
  logDir: string;
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
  paths: StoragePaths;
  /** Linux group that grants access to serial ports (dialout, uucp …). */
  serialGroup: string | null;
  repository: string;
  /** False when update checks are switched off for this run (SMP_NO_UPDATE_CHECK=1). */
  updateCheck: boolean;
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
  | 'check-updates'
  | 'send-file'
  | 'capture'
  | 'replay'
  | `theme:${Theme}`;

export interface SmpApi {
  serial: {
    list(includeSimulated: boolean): Promise<PortInfo[]>;
    open(id: string, options: OpenOptions): Promise<Result>;
    close(id: string): Promise<void>;
    write(id: string, data: Uint8Array): Promise<Result>;
    /** Opens the port briefly and returns what arrived (baud rate scanner). */
    sample(path: string, baudRate: number, ms: number): Promise<ValueResult<Uint8Array>>;
    setLines(id: string, lines: ControlLines): Promise<Result>;
    getLines(id: string): Promise<ValueResult<ModemLines>>;
    /** Holds the line in the break state for `ms` milliseconds. */
    sendBreak(id: string, ms: number): Promise<Result>;
    onEvent(listener: (event: SerialEvent) => void): () => void;
  };
  store: {
    load(name: StoreName): Promise<unknown>;
    save(name: StoreName, data: unknown): Promise<boolean>;
  };
  files: {
    saveText(defaultName: string, content: string, filters: FileFilter[]): Promise<string | null>;
    /**
     * Saves without a dialog into the capture folder (Documents/Serial Monitor Pro).
     * Returns the path, or null when the file could not be written.
     */
    saveAuto(name: string, content: string): Promise<string | null>;
    /** Folder dialog; null when cancelled. */
    chooseFolder(current: string, title: string): Promise<string | null>;
    openText(filters: FileFilter[]): Promise<{ path: string; content: string } | null>;
    /** null = cancelled; a failure for unreadable or too large files. */
    openBinary(maxBytes: number): Promise<ValueResult<BinaryFile> | null>;
  };
  log: {
    start(defaultName: string): Promise<string | null>;
    write(text: string): void;
    stop(): Promise<void>;
  };
  capture: {
    /** Save dialog, then records everything of connection `id`; null when cancelled. */
    start(id: string, defaultName: string): Promise<string | null>;
    stop(): Promise<CaptureStats | null>;
  };
  replay: {
    /** Open dialog for a capture; it becomes a simulated device. null when cancelled. */
    load(options: ReplayOptions): Promise<ValueResult<ReplayInfo> | null>;
    list(): Promise<ReplayInfo[]>;
    remove(path: string): Promise<void>;
    configure(path: string, options: ReplayOptions): Promise<ReplayInfo | null>;
  };
  app: {
    /**
     * Applies the folders of the settings. Invalid folders are ignored; the
     * result says which ones are in effect and where the files now are.
     */
    setPaths(folders: FolderSettings): Promise<{ applied: FolderSettings; paths: StoragePaths }>;
    info(): Promise<AppInfo>;
    setTheme(theme: Theme): void;
    setLanguage(language: Language): void;
    openExternal(url: string): Promise<void>;
    /** The published releases, newest first. */
    releases(): Promise<ValueResult<ReleaseInfo[]>>;
    onMenu(listener: (action: MenuAction) => void): () => void;
    onCloseRequested(listener: () => void): () => void;
    closeReady(): void;
  };
}

export const IPC = {
  serialList: 'serial:list',
  serialOpen: 'serial:open',
  serialClose: 'serial:close',
  serialWrite: 'serial:write',
  serialSample: 'serial:sample',
  serialSetLines: 'serial:set-lines',
  serialGetLines: 'serial:get-lines',
  serialBreak: 'serial:break',
  serialEvent: 'serial:event',
  storeLoad: 'store:load',
  storeSave: 'store:save',
  fileSave: 'file:save',
  fileSaveAuto: 'file:save-auto',
  fileChooseFolder: 'file:choose-folder',
  appSetPaths: 'app:set-paths',
  fileOpen: 'file:open',
  fileOpenBinary: 'file:open-binary',
  logStart: 'log:start',
  logWrite: 'log:write',
  logStop: 'log:stop',
  captureStart: 'capture:start',
  captureStop: 'capture:stop',
  replayLoad: 'replay:load',
  replayList: 'replay:list',
  replayRemove: 'replay:remove',
  replayConfigure: 'replay:configure',
  appInfo: 'app:info',
  appTheme: 'app:theme',
  appLanguage: 'app:language',
  appExternal: 'app:external',
  appReleases: 'app:releases',
  appMenu: 'app:menu',
  appCloseRequested: 'app:close-requested',
  appCloseReady: 'app:close-ready',
} as const;
