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
  },
  log: {
    start: (defaultName) => ipcRenderer.invoke(IPC.logStart, defaultName),
    write: (text) => ipcRenderer.send(IPC.logWrite, text),
    stop: () => ipcRenderer.invoke(IPC.logStop),
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    setTheme: (theme) => ipcRenderer.send(IPC.appTheme, theme),
    setLanguage: (language) => ipcRenderer.send(IPC.appLanguage, language),
    openExternal: (url) => ipcRenderer.invoke(IPC.appExternal, url),
    onMenu: (listener) => subscribe<MenuAction>(IPC.appMenu, listener),
  },
};

contextBridge.exposeInMainWorld('smp', api);
