import { useSyncExternalStore } from 'react';
import { getLanguage, onLanguageChange, t } from '@shared/i18n';

/** Re-renders the component when the language changes and returns `t`. */
export function useT(): typeof t {
  useSyncExternalStore(onLanguageChange, getLanguage);
  return t;
}
