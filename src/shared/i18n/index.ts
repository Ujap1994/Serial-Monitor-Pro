import { de } from './de';
import { en } from './en';

export type Language = 'de' | 'en';
export type LanguageSetting = Language | 'auto';
export type MessageKey = keyof typeof de;
export type Messages = Record<MessageKey, string>;
export type Params = Record<string, string | number>;

const dictionaries: Record<Language, Messages> = { de, en };

let current: Language = 'en';
const listeners = new Set<(lang: Language) => void>();

/** Picks German for German system locales and English for everything else. */
export function resolveLanguage(setting: LanguageSetting, systemLocale: string): Language {
  if (setting === 'de' || setting === 'en') return setting;
  return systemLocale.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  for (const listener of listeners) listener(lang);
}

export function getLanguage(): Language {
  return current;
}

export function onLanguageChange(listener: (lang: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replaces `{name}` placeholders with the given values. */
export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function t(key: MessageKey, params?: Params): string {
  const text = dictionaries[current][key] ?? dictionaries.en[key] ?? key;
  return interpolate(text, params);
}

/** Translation in an explicit language (used by the main process menu). */
export function tIn(lang: Language, key: MessageKey, params?: Params): string {
  return interpolate(dictionaries[lang][key] ?? key, params);
}

/** Formats an integer with the locale's thousands separator. */
export function formatCount(value: number): string {
  return value.toLocaleString(current === 'de' ? 'de-DE' : 'en-US');
}
