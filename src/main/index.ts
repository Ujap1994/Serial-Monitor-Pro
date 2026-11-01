// Main process: window, menu, serial ports, storage.

import { createWriteStream, readFileSync, type WriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, shell } from 'electron';
import { resolveLanguage, setLanguage, t, type Language } from '@shared/i18n';
import {
  IPC,
  type AppInfo,
  type BinaryFile,
  type CaptureStats,
  type ReplayInfo,
  type ControlLines,
  type FileFilter,
  type FolderSettings,
  type MenuAction,
  type OpenOptions,
  type ReleaseInfo,
  type StoragePaths,
  type StoreName,
  type ValueResult,
} from '@shared/ipc';
import type { Theme } from '@shared/core/settings';
import { newerReleases, parseReleases } from '@shared/core/updates';
import { CAPTURE_EXTENSION, CaptureError, parseCapture } from '@shared/core/capture';
import { normalizeReplayOptions, type ReplayOptions } from '@shared/core/replay';
import icon from '../../resources/icon.png?asset';
import { APP_NAME, REPOSITORY_URL } from './constants';
import { buildMenu } from './menu';
import { CaptureWriter } from './capture';
import { listPorts, SerialManager } from './serial';
import {
  addReplay,
  configureReplay,
  removeReplay,
  replayList,
  replayPorts,
  simulatedPorts,
} from './simulator';
import { isUsableFolder, Storage } from './storage';
import { fetchNewerReleases } from './updates';
import { loadWindowState, trackWindowState } from './window-state';

const here = fileURLToPath(new URL('.', import.meta.url));

// Isolated profile for automated tests (keeps the developer's data untouched).
if (process.env.SMP_USER_DATA_DIR) app.setPath('userData', process.env.SMP_USER_DATA_DIR);
// Electron keys its process singleton by userData. Set the profile first so
// parallel tests remain independent while each individual profile stays locked.
const primaryInstance = app.requestSingleInstanceLock();

const simulatorForced = process.argv.includes('--simulator') || process.env.SMP_SIMULATOR === '1';
// Screenshots and demos must not show the real devices of whoever creates them.
const simulatedOnly = process.env.SMP_SIMULATED_ONLY === '1';
const STORES: StoreName[] = ['settings', 'commands', 'automation'];

let mainWindow: BrowserWindow | null = null;
let language: Language = 'en';
let logStream: WriteStream | null = null;
let capture: { id: string; writer: CaptureWriter } | null = null;
/** Largest capture that is loaded for a replay. */
const MAX_REPLAY_BYTES = 200 * 1024 * 1024;
let quitting = false;
let shutdownFinished = false;
let closeRequested = false;
const pendingSaves = new Set<Promise<boolean>>();
const saveQueues = new Map<StoreName, Promise<boolean>>();

const storage = new Storage(app.getPath('userData'));
/** Log/export folder chosen in the settings ('' = Documents). */
let logDir = '';
const logFolder = (): string => logDir || app.getPath('documents');

function storagePaths(): StoragePaths {
  return {
    userData: app.getPath('userData'),
    settings: storage.path('settings'),
    commands: storage.path('commands'),
    automation: storage.path('automation'),
    logs: logDir || join(app.getPath('documents'), 'Serial Monitor Pro'),
  };
}
const serial = new SerialManager((event) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.serialEvent, event);
});

function sendMenu(action: MenuAction): void {
  mainWindow?.webContents.send(IPC.appMenu, action);
}

function applyMenu(): void {
  Menu.setApplicationMenu(buildMenu(language, () => mainWindow, sendMenu));
}

/** Linux group that grants access to serial ports, if the user is not yet a member. */
function serialGroup(): string | null {
  if (process.platform !== 'linux') return null;
  try {
    const groups = readFileSync('/etc/group', 'utf8');
    for (const name of ['dialout', 'uucp', 'tty']) {
      if (new RegExp(`^${name}:`, 'm').test(groups)) return name;
    }
  } catch {
    // ignore
  }
  return 'dialout';
}

function backgroundFor(theme: Theme): string {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#0b1220' : '#f3f5f9';
}

function createWindow(): void {
  if (quitting) return;
  const state = loadWindowState(app.getPath('userData'));
  const win = new BrowserWindow({
    ...(state.centered ? { width: state.bounds.width, height: state.bounds.height } : state.bounds),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    icon,
    backgroundColor: backgroundFor('system'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Sequences and automation rely on timers – keep them accurate in the background.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  trackWindowState(win, app.getPath('userData'));

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
  });

  // External links open in the browser; navigation away from the app is blocked.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  win.on('close', (event) => {
    event.preventDefault();
    requestWindowClose();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, '../renderer/index.html'));
}

function registerIpc(): void {
  ipcMain.on(IPC.appCloseReady, (event) => {
    if (closeRequested && mainWindow?.webContents === event.sender) mainWindow.destroy();
  });
  ipcMain.handle(IPC.serialList, async (_e, includeSimulated: boolean) => [
    ...(simulatedOnly
      ? simulatedPorts()
      : await listPorts(Boolean(includeSimulated) || simulatorForced)),
    ...replayPorts(),
  ]);
  ipcMain.handle(IPC.serialOpen, (_e, id: string, options: OpenOptions) =>
    quitting
      ? { ok: false, error: 'Application is closing', code: 'unknown' }
      : serial.open(String(id), options),
  );
  ipcMain.handle(IPC.serialClose, (_e, id: string) => serial.close(String(id)));
  ipcMain.handle(IPC.serialWrite, (_e, id: string, data: Uint8Array) =>
    serial.write(String(id), new Uint8Array(data)),
  );
  ipcMain.handle(IPC.serialSample, (_e, path: string, baud: number, ms: number) =>
    quitting
      ? { ok: false, error: 'Application is closing', code: 'unknown' }
      : serial.sample(String(path), Number(baud), Math.min(5000, Math.max(50, Number(ms) || 50))),
  );
  ipcMain.handle(IPC.serialSetLines, (_e, id: string, lines: ControlLines) =>
    serial.setLines(String(id), { dtr: Boolean(lines?.dtr), rts: Boolean(lines?.rts) }),
  );
  ipcMain.handle(IPC.serialGetLines, (_e, id: string) => serial.getLines(String(id)));
  ipcMain.handle(IPC.serialBreak, (_e, id: string, ms: number) =>
    serial.sendBreak(String(id), Math.min(5000, Math.max(10, Number(ms) || 250))),
  );

  ipcMain.handle(IPC.storeLoad, (_e, name: StoreName) =>
    STORES.includes(name) ? storage.load(name) : null,
  );
  ipcMain.handle(IPC.storeSave, async (_e, name: StoreName, data: unknown) => {
    if (!STORES.includes(name)) return false;
    // Debounced saves and the final flush must not race on the same temp file.
    const saved = (saveQueues.get(name) ?? Promise.resolve(true)).then(() =>
      storage.save(name, data),
    );
    saveQueues.set(name, saved);
    pendingSaves.add(saved);
    try {
      return await saved;
    } finally {
      pendingSaves.delete(saved);
      if (saveQueues.get(name) === saved) saveQueues.delete(name);
    }
  });

  ipcMain.handle(
    IPC.fileSave,
    async (_e, defaultName: string, content: string, filters: FileFilter[]) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: join(logFolder(), defaultName),
        filters,
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, content, 'utf8');
      return result.filePath;
    },
  );
  // Unattended captures (stop condition "save"): no dialog, a fixed folder and
  // a sanitised file name – the renderer cannot choose the directory.
  ipcMain.handle(IPC.fileSaveAuto, async (_e, name: string, content: string) => {
    const dir = process.env.SMP_CAPTURE_DIR || storagePaths().logs;
    const safe =
      basename(String(name))
        .replace(/[^\w.-]/g, '_')
        .slice(0, 120) || 'capture.txt';
    try {
      await mkdir(dir, { recursive: true });
      const path = join(dir, safe);
      await writeFile(path, String(content), 'utf8');
      return path;
    } catch (err) {
      console.warn('[files] automatic save failed:', err);
      return null;
    }
  });
  ipcMain.handle(IPC.fileChooseFolder, async (_e, current: string, title: string) => {
    if (!mainWindow) return null;
    const start = String(current ?? '');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: String(title),
      defaultPath: start && (await isUsableFolder(start)) ? start : logFolder(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  // Folders of the settings: data folder for commands/automation and the
  // log/export folder. Only absolute, existing folders are accepted.
  ipcMain.handle(IPC.appSetPaths, async (_e, folders: FolderSettings) => {
    const dataDir = String(folders?.dataDir ?? '').trim();
    const wantedLog = String(folders?.logDir ?? '').trim();
    if (!(await storage.setDataDir(dataDir)))
      console.warn(`[storage] data folder not usable: ${dataDir}`);
    logDir = (await isUsableFolder(wantedLog)) ? wantedLog : '';
    return { applied: { dataDir: storage.customDataDir, logDir }, paths: storagePaths() };
  });
  ipcMain.handle(IPC.fileOpen, async (_e, filters: FileFilter[]) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return { path, content: await readFile(path, 'utf8') };
  });

  ipcMain.handle(
    IPC.fileOpenBinary,
    async (_e, maxBytes: number): Promise<ValueResult<BinaryFile> | null> => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      try {
        const { size } = await stat(path);
        if (size > maxBytes) {
          return {
            ok: false,
            error: t('sendfile.tooLarge', { size, max: maxBytes }),
            code: 'unknown',
          };
        }
        return { ok: true, value: { path, name: basename(path), data: await readFile(path) } };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: 'unknown',
        };
      }
    },
  );

  ipcMain.handle(IPC.logStart, async (_e, defaultName: string) => {
    if (!mainWindow || quitting) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: join(logFolder(), defaultName),
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    });
    if (result.canceled || !result.filePath || quitting) return null;
    await finishLog();
    if (quitting) return null;
    logStream = createWriteStream(result.filePath, { flags: 'a', encoding: 'utf8' });
    logStream.on('error', (error) => console.warn('[log] write failed:', error));
    return result.filePath;
  });
  ipcMain.on(IPC.logWrite, (_e, text: string) => {
    logStream?.write(String(text));
  });
  ipcMain.handle(IPC.logStop, () => finishLog());

  // Session capture: every byte of one connection, with direction and time.
  ipcMain.handle(IPC.captureStart, async (_e, id: string, defaultName: string) => {
    if (!mainWindow || quitting) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: join(
        logFolder(),
        basename(String(defaultName || `capture.${CAPTURE_EXTENSION}`)),
      ),
      filters: [{ name: t('capture.fileType'), extensions: [CAPTURE_EXTENSION] }],
    });
    if (result.canceled || !result.filePath || quitting) return null;
    await finishCapture();
    const writer = new CaptureWriter(
      result.filePath,
      app.getVersion(),
      serial.optionsOf(String(id)),
    );
    capture = { id: String(id), writer };
    serial.setTap(capture.id, (event) => writer.record(event));
    return result.filePath;
  });
  ipcMain.handle(IPC.captureStop, () => finishCapture());

  // A capture as a simulated device.
  ipcMain.handle(
    IPC.replayLoad,
    async (_e, options: ReplayOptions): Promise<ValueResult<ReplayInfo> | null> => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: t('capture.fileType'), extensions: [CAPTURE_EXTENSION, 'jsonl'] },
          { name: t('capture.allFiles'), extensions: ['*'] },
        ],
      });
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      try {
        const { size } = await stat(path);
        if (size > MAX_REPLAY_BYTES)
          return {
            ok: false,
            error: t('replay.tooLarge', { size, max: MAX_REPLAY_BYTES }),
            code: 'unknown',
          };
        const parsed = parseCapture(await readFile(path, 'utf8'));
        return {
          ok: true,
          value: addReplay(basename(path), parsed, normalizeReplayOptions(options)),
        };
      } catch (err) {
        const message =
          err instanceof CaptureError || err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, code: 'unknown' };
      }
    },
  );
  ipcMain.handle(IPC.replayList, () => replayList());
  ipcMain.handle(IPC.replayRemove, async (_e, path: string) => {
    // A replay that is in use is closed first.
    await serial.closePath(String(path));
    removeReplay(String(path));
  });
  ipcMain.handle(IPC.replayConfigure, (_e, path: string, options: ReplayOptions) =>
    configureReplay(String(path), normalizeReplayOptions(options)),
  );

  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return {
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      locale: app.getLocale(),
      simulatorForced,
      paths: storagePaths(),
      serialGroup: serialGroup(),
      repository: REPOSITORY_URL,
      updateCheck: process.env.SMP_NO_UPDATE_CHECK !== '1',
    };
  });
  ipcMain.on(IPC.appTheme, (_e, theme: Theme) => {
    if (theme === 'system' || theme === 'light' || theme === 'dark') {
      nativeTheme.themeSource = theme;
      mainWindow?.setBackgroundColor(backgroundFor(theme));
    }
  });
  ipcMain.on(IPC.appLanguage, (_e, lang: Language) => {
    if ((lang === 'de' || lang === 'en') && lang !== language) {
      language = lang;
      setLanguage(language);
      applyMenu();
    }
  });
  ipcMain.handle(IPC.appExternal, async (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url);
  });
  ipcMain.handle(IPC.appReleases, async (): Promise<ValueResult<ReleaseInfo[]>> => {
    try {
      // A local file stands in for GitHub in tests and screenshots.
      const feed = process.env.SMP_UPDATE_FEED;
      const releases = feed
        ? newerReleases(
            parseReleases(JSON.parse(await readFile(feed, 'utf8')) as unknown),
            app.getVersion(),
          )
        : await fetchNewerReleases((url, options) => net.fetch(url, options), app.getVersion());
      return { ok: true, value: releases };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: 'unknown',
      };
    }
  });
}

app.setAppUserModelId('io.github.ujap1994.SerialMonitorPro');

if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || quitting) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  void app.whenReady().then(() => {
    if (quitting) return;
    language = resolveLanguage('auto', app.getLocale());
    setLanguage(language);
    registerIpc();
    applyMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  shutdown();
});

async function finishCapture(): Promise<CaptureStats | null> {
  const current = capture;
  capture = null;
  if (!current) return null;
  serial.setTap(current.id, null);
  return current.writer.finish();
}

async function finishLog(): Promise<void> {
  const stream = logStream;
  logStream = null;
  if (!stream) return;
  const closed = finished(stream, { cleanup: true });
  stream.end();
  await closed;
}

let shutdownStarted = false;
function requestWindowClose(): void {
  if (!mainWindow) return shutdown();
  if (closeRequested) return;
  closeRequested = true;
  quitting = true;
  if (mainWindow.webContents.isLoadingMainFrame() || mainWindow.webContents.isCrashed()) {
    mainWindow.destroy();
    return;
  }
  mainWindow.webContents.send(IPC.appCloseRequested);
}

function shutdown(): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  quitting = true;
  void Promise.allSettled([serial.closeAll(), finishLog(), finishCapture(), ...pendingSaves]).then(
    (results) => {
      for (const result of results) {
        if (result.status === 'rejected') console.warn('[shutdown] cleanup failed:', result.reason);
      }
      shutdownFinished = true;
      app.quit();
    },
  );
}

app.on('before-quit', (event) => {
  if (!primaryInstance || shutdownFinished) return;
  event.preventDefault();
  quitting = true;
  requestWindowClose();
});
