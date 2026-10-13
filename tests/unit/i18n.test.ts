import { describe, expect, it } from 'vitest';
import { de } from '@shared/i18n/de';
import { en } from '@shared/i18n/en';
import { interpolate, resolveLanguage } from '@shared/i18n';

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
