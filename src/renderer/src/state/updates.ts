// Update notice: compares the running version with the releases on GitHub.

import { newerReleases } from '@shared/core/updates';
import { appStore } from './app';
import { openDialog, uiStore } from './ui';

/** Latest version without the leading "v", or '' when up to date. */
export function latestVersion(): string {
  return appStore.get().update?.newer[0]?.tag.replace(/^v/, '') ?? '';
}

/**
 * `manual` – from the menu or the About dialog: always shows the result, even
 * "up to date" or an error. Otherwise (at startup) it stays silent unless a
 * new version exists that the user has not chosen to skip.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  const { info, settings } = appStore.get();
  if (!info) return;
  if (!manual && (!info.updateCheck || !settings.updateCheck)) return;
  const result = await window.smp.app.releases();
  if (!result.ok) {
    if (!manual) return;
    appStore.set({ update: { newer: appStore.get().update?.newer ?? [], error: result.error } });
    openDialog('update');
    return;
  }
  appStore.set({ update: { newer: newerReleases(result.value, info.version), error: null } });
  const latest = latestVersion();
  const skipped = appStore.get().settings.updateSkipped;
  if (manual || (latest && latest !== skipped && !uiStore.get().dialog)) openDialog('update');
}
