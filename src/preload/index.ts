// Preload script: exposes a small, typed API to the renderer.
// The renderer has no direct access to Node.js or Electron.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type MenuAction, type SerialEvent, type SmpApi } from '../shared/ipc';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: SmpApi = {
  serial: {
    list: (includeSimulated) => ipcRenderer.invoke(IPC.serialList, includeSimulated),
    open: (id, options) => ipcRenderer.invoke(IPC.serialOpen, id, options),
    close: (id) => ipcRenderer.invoke(IPC.serialClose, id),
    write: (id, data) => ipcRenderer.invoke(IPC.serialWrite, id, data),
    sample: (path, baudRate, ms) => ipcRenderer.invoke(IPC.serialSample, path, baudRate, ms),
    setLines: (id, lines) => ipcRenderer.invoke(IPC.serialSetLines, id, lines),
    getLines: (id) => ipcRenderer.invoke(IPC.serialGetLines, id),
    sendBreak: (id, ms) => ipcRenderer.invoke(IPC.serialBreak, id, ms),
    onEvent: (listener) => subscribe<SerialEvent>(IPC.serialEvent, listener),
  },
  store: {
    load: (name) => ipcRenderer.invoke(IPC.storeLoad, name),
    save: (name, data) => ipcRenderer.invoke(IPC.storeSave, name, data),
  },
  files: {
    saveText: (defaultName, content, filters) =>
      ipcRenderer.invoke(IPC.fileSave, defaultName, content, filters),
    openText: (filters) => ipcRenderer.invoke(IPC.fileOpen, filters),
    openBinary: (maxBytes) => ipcRenderer.invoke(IPC.fileOpenBinary, maxBytes),
  },
  log: {
    start: (defaultName) => ipcRenderer.invoke(IPC.logStart, defaultName),
    write: (text) => ipcRenderer.send(IPC.logWrite, text),
    stop: () => ipcRenderer.invoke(IPC.logStop),
  },
  app: {
    onCloseRequested: (listener) => subscribe<void>(IPC.appCloseRequested, listener),
    closeReady: () => ipcRenderer.send(IPC.appCloseReady),
    info: () => ipcRenderer.invoke(IPC.appInfo),
    setTheme: (theme) => ipcRenderer.send(IPC.appTheme, theme),
    setLanguage: (language) => ipcRenderer.send(IPC.appLanguage, language),
    openExternal: (url) => ipcRenderer.invoke(IPC.appExternal, url),
    releases: () => ipcRenderer.invoke(IPC.appReleases),
    onMenu: (listener) => subscribe<MenuAction>(IPC.appMenu, listener),
  },
};

contextBridge.exposeInMainWorld('smp', api);
