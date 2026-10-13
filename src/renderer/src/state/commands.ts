// Import and export of stored commands (presets / send table).

import { t } from '@shared/i18n';
import { parseCommandFile, serializeCommands } from '@shared/core/commands';
import { appStore, setCommands, setStatus } from './app';
import { alertDialog, choose, toast } from './ui';

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }];

export async function exportCommands(): Promise<void> {
  const commands = appStore.get().commands;
  if (!commands.length) {
    await alertDialog(t('presets.exportEmptyTitle'), t('presets.exportEmpty'));
    return;
  }
  const path = await window.smp.files.saveText(
    'commands.json',
    serializeCommands(commands),
    JSON_FILTER,
  );
  if (path) toast(t('presets.exported', { count: commands.length }), 'ok');
}

export async function importCommands(): Promise<void> {
  const file = await window.smp.files.openText(JSON_FILTER);
  if (!file) return;
  let imported;
  try {
    imported = parseCommandFile(file.content);
  } catch (err) {
    await alertDialog(
      t('presets.importFailed'),
      err instanceof Error ? err.message : String(err),
      'error',
    );
    return;
  }
  if (!imported.length) {
    await alertDialog(t('presets.importTitle'), t('presets.importEmpty'));
    return;
  }
  const existing = appStore.get().commands;
  const mode = existing.length
    ? await choose<'append' | 'replace' | null>(
        t('presets.importTitle'),
        t('presets.importQuestion', { count: imported.length }),
        [
          { label: t('common.cancel'), value: null },
          { label: t('presets.importReplace'), value: 'replace', variant: 'danger' },
          { label: t('presets.importAppend'), value: 'append', variant: 'primary' },
        ],
        null,
      )
    : 'replace';
  if (!mode) return;
  setCommands(mode === 'append' ? [...existing, ...imported] : imported);
  setStatus(t('presets.imported', { count: imported.length }), 'ok');
  toast(t('presets.imported', { count: imported.length }), 'ok');
}
