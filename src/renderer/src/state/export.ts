// Saving the monitor content as text or CSV.

import { t } from '@shared/i18n';
import { fileStamp } from '@shared/core/timestamp';
import { entriesToCsv, lineToText, renderEntry } from '../lib/monitor';
import { setStatus } from './app';
import { monitor, renderOptions } from './serial';
import { alertDialog, toast } from './ui';

async function ensureContent(): Promise<boolean> {
  if (monitor.size) return true;
  await alertDialog(t('export.emptyTitle'), t('export.empty'));
  return false;
}

export async function exportText(): Promise<void> {
  if (!(await ensureContent())) return;
  const o = renderOptions();
  const content = monitor
    .all()
    .map((e) => lineToText(renderEntry(e, o)))
    .join('\n');
  const path = await window.smp.files.saveText(`serial_${fileStamp()}.txt`, `${content}\n`, [
    { name: t('export.textFiles'), extensions: ['txt', 'log'] },
  ]);
  if (path) {
    setStatus(t('export.saved', { path }), 'ok');
    toast(t('export.saved', { path }), 'ok');
  }
}

export async function exportCsv(): Promise<void> {
  if (!(await ensureContent())) return;
  const header = [
    t('export.col.time'),
    t('export.col.direction'),
    t('export.col.bytes'),
    'HEX',
    t('export.col.text'),
  ];
  const path = await window.smp.files.saveText(
    `serial_${fileStamp()}.csv`,
    entriesToCsv(monitor.all(), header),
    [{ name: 'CSV', extensions: ['csv'] }],
  );
  if (path) {
    setStatus(t('export.saved', { path }), 'ok');
    toast(t('export.saved', { path }), 'ok');
  }
}
