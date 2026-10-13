// Application menu (translated, rebuilt whenever the language changes).

import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { tIn, type Language } from '@shared/i18n';
import type { MenuAction } from '@shared/ipc';
import { REPOSITORY_URL } from './constants';

export function buildMenu(
  lang: Language,
  getWindow: () => BrowserWindow | null,
  send: (action: MenuAction) => void,
): Menu {
  const tr = (key: Parameters<typeof tIn>[1]): string => tIn(lang, key);
  const isMac = process.platform === 'darwin';
  const item = (
    label: string,
    action: MenuAction,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(action),
  });

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      role: 'appMenu',
      submenu: [
        item(tr('menu.about'), 'about'),
        { type: 'separator' },
        item(tr('menu.settings'), 'settings', 'Cmd+,'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: tr('menu.file'),
    submenu: [
      item(tr('menu.exportTxt'), 'export-txt', 'CmdOrCtrl+S'),
      item(tr('menu.exportCsv'), 'export-csv', 'CmdOrCtrl+Shift+S'),
      { type: 'separator' },
      item(tr('menu.importCommands'), 'import-commands'),
      item(tr('menu.exportCommands'), 'export-commands'),
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            item(tr('menu.settings'), 'settings', 'Ctrl+,'),
            { type: 'separator' },
            { role: 'quit', label: tr('menu.quit') },
          ] as MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    label: tr('menu.edit'),
    submenu: [
      { role: 'undo', label: tr('menu.undo') },
      { role: 'redo', label: tr('menu.redo') },
      { type: 'separator' },
      { role: 'cut', label: tr('menu.cut') },
      { role: 'copy', label: tr('menu.copy') },
      { role: 'paste', label: tr('menu.paste') },
      { role: 'selectAll', label: tr('menu.selectAll') },
    ],
  });

  template.push({
    label: tr('menu.connection'),
    submenu: [
      item(tr('menu.toggleConnection'), 'toggle-connection', 'CmdOrCtrl+K'),
      item(tr('menu.refreshPorts'), 'refresh-ports', 'F5'),
      item(tr('menu.baudScan'), 'baud-scan'),
    ],
  });

  template.push({
    label: tr('menu.view'),
    submenu: [
      item(tr('menu.clear'), 'clear', 'CmdOrCtrl+L'),
      { type: 'separator' },
      {
        label: tr('menu.theme'),
        submenu: [
          item(tr('settings.theme.system'), 'theme:system'),
          item(tr('settings.theme.light'), 'theme:light'),
          item(tr('settings.theme.dark'), 'theme:dark'),
        ],
      },
      { type: 'separator' },
      { role: 'zoomIn', label: tr('menu.zoomIn') },
      { role: 'zoomOut', label: tr('menu.zoomOut') },
      { role: 'resetZoom', label: tr('menu.resetZoom') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: tr('menu.fullscreen') },
      {
        label: tr('menu.devtools'),
        accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
        click: () => getWindow()?.webContents.toggleDevTools(),
      },
    ],
  });

  template.push({
    role: 'help',
    label: tr('menu.help'),
    submenu: [
      item(tr('menu.shortcuts'), 'shortcuts', 'F1'),
      { label: tr('menu.docs'), click: () => void shell.openExternal(`${REPOSITORY_URL}#readme`) },
      {
        label: tr('menu.changelog'),
        click: () => void shell.openExternal(`${REPOSITORY_URL}/blob/main/CHANGELOG.md`),
      },
      {
        label: tr('menu.issue'),
        click: () => void shell.openExternal(`${REPOSITORY_URL}/issues/new/choose`),
      },
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            item(tr('menu.about'), 'about'),
          ] as MenuItemConstructorOptions[])),
    ],
  });

  return Menu.buildFromTemplate(template);
}
