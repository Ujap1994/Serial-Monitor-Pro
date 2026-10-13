// Main process: window, menu, serial ports, storage.

import { createWriteStream, readFileSync, type WriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { resolveLanguage, setLanguage, type Language } from '@shared/i18n';
import {
  IPC,
  type AppInfo,
  type FileFilter,
  type MenuAction,
  type OpenOptions,
  type StoreName,
} from '@shared/ipc';
import type { Theme } from '@shared/core/settings';
import icon from '../../resources/icon.png?asset';
import { APP_NAME, REPOSITORY_URL } from './constants';
import { buildMenu } from './menu';
import { listPorts, SerialManager } from './serial';
import { Storage } from './storage';
import { loadWindowState, trackWindowState } from './window-state';

const here = fileURLToPath(new URL('.', import.meta.url));

// Isolated profile for automated tests (keeps the developer's data untouched).
if (process.env.SMP_USER_DATA_DIR) app.setPath('userData', process.env.SMP_USER_DATA_DIR);

const simulatorForced = process.argv.includes('--simulator') || process.env.SMP_SIMULATOR === '1';
const STORES: StoreName[] = ['settings', 'commands', 'automation'];

let mainWindow: BrowserWindow | null = null;
let language: Language = 'en';
let logStream: WriteStream | null = null;

const storage = new Storage(app.getPath('userData'));
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

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    void serial.closeAll();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, '../renderer/index.html'));
}

function registerIpc(): void {
  ipcMain.handle(IPC.serialList, (_e, includeSimulated: boolean) =>
    listPorts(Boolean(includeSimulated) || simulatorForced),
  );
  ipcMain.handle(IPC.serialOpen, (_e, id: string, options: OpenOptions) =>
    serial.open(String(id), options),
  );
  ipcMain.handle(IPC.serialClose, (_e, id: string) => serial.close(String(id)));
  ipcMain.handle(IPC.serialWrite, (_e, id: string, data: Uint8Array) =>
    serial.write(String(id), new Uint8Array(data)),
  );
  ipcMain.handle(IPC.serialSample, (_e, path: string, baud: number, ms: number) =>
    serial.sample(String(path), Number(baud), Math.min(5000, Math.max(50, Number(ms)))),
  );

  ipcMain.handle(IPC.storeLoad, (_e, name: StoreName) =>
    STORES.includes(name) ? storage.load(name) : null,
  );
  ipcMain.handle(IPC.storeSave, (_e, name: StoreName, data: unknown) =>
    STORES.includes(name) ? storage.save(name, data) : false,
  );

  ipcMain.handle(
    IPC.fileSave,
    async (_e, defaultName: string, content: string, filters: FileFilter[]) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: join(app.getPath('documents'), defaultName),
        filters,
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, content, 'utf8');
      return result.filePath;
    },
  );
  ipcMain.handle(IPC.fileOpen, async (_e, filters: FileFilter[]) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return { path, content: await readFile(path, 'utf8') };
  });

  ipcMain.handle(IPC.logStart, async (_e, defaultName: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    });
    if (result.canceled || !result.filePath) return null;
    logStream?.end();
    logStream = createWriteStream(result.filePath, { flags: 'a', encoding: 'utf8' });
    return result.filePath;
  });
  ipcMain.on(IPC.logWrite, (_e, text: string) => {
    logStream?.write(String(text));
  });
  ipcMain.handle(
    IPC.logStop,
    () =>
      new Promise<void>((resolve) => {
        if (!logStream) return resolve();
        logStream.end(() => resolve());
        logStream = null;
      }),
  );

  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    const ud = app.getPath('userData');
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
      paths: {
        userData: ud,
        settings: storage.path('settings'),
        commands: storage.path('commands'),
        automation: storage.path('automation'),
      },
      serialGroup: serialGroup(),
      repository: REPOSITORY_URL,
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
}

app.setAppUserModelId('io.github.ujap1994.SerialMonitorPro');

void app.whenReady().then(() => {
  language = resolveLanguage('auto', app.getLocale());
  setLanguage(language);
  registerIpc();
  applyMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  logStream?.end();
  logStream = null;
  void serial.closeAll();
});
