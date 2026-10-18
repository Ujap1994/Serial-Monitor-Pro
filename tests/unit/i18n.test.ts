import { describe, expect, it } from 'vitest';
import { de } from '@shared/i18n/de';
import { en } from '@shared/i18n/en';
import {
  formatCount,
  getLanguage,
  interpolate,
  onLanguageChange,
  resolveLanguage,
  setLanguage,
  t,
  tIn,
} from '@shared/i18n';

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('translations', () => {
  it('have the same keys in German and English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });

  it.each(Object.keys(de))('%s uses the same placeholders in both languages', (key) => {
    const k = key as keyof typeof de;
    expect(placeholders(en[k])).toEqual(placeholders(de[k]));
  });

  it('contain no empty texts', () => {
    for (const [key, value] of [...Object.entries(de), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('interpolates placeholders', () => {
    expect(interpolate('{a} und {b}', { a: 1, b: 'zwei' })).toBe('1 und zwei');
    expect(interpolate('{missing}', {})).toBe('{missing}');
  });

  it('resolves the system language', () => {
    expect(resolveLanguage('auto', 'de-AT')).toBe('de');
    expect(resolveLanguage('auto', 'fr-FR')).toBe('en');
    expect(resolveLanguage('en', 'de-DE')).toBe('en');
  });
});

describe('switching the language', () => {
  it('notifies listeners once per real change and lets them unsubscribe', () => {
    setLanguage('en');
    const seen: string[] = [];
    const off = onLanguageChange((lang) => seen.push(lang));
    setLanguage('de');
    setLanguage('de');
    off();
    setLanguage('en');
    expect(seen).toEqual(['de']);
    expect(getLanguage()).toBe('en');
  });

  it('translates in the current or an explicit language', () => {
    setLanguage('de');
    expect(t('nmea.notNmea')).toBe(de['nmea.notNmea']);
    expect(tIn('en', 'nmea.notNmea')).toBe(en['nmea.notNmea']);
    setLanguage('en');
  });

  it('formats counts with the thousands separator of the language', () => {
    setLanguage('de');
    expect(formatCount(1234567)).toBe('1.234.567');
    setLanguage('en');
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});
