// Extraction of measurement values for the live graph.

import { t } from '../i18n';

export type ExtractMode = 'auto' | 'labeled' | 'separated';

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function toNumber(text: string): number | null {
  const s = text.trim().replace(',', '.');
  return NUMBER.test(s) ? Number(s) : null;
}

/**
 * Pulls numbers out of a text line.
 *
 *  auto      – recognises 'name:value' pairs, otherwise all numbers in order
 *  labeled   – only 'name:value' or 'name=value'
 *  separated – separated numbers, named "Value 1", "Value 2" …
 */
export function extractValues(
  input: string,
  mode: ExtractMode = 'auto',
  separator = ',',
): Record<string, number> {
  const line = (input ?? '').trim();
  if (!line) return {};
  const out: Record<string, number> = {};
  const tokens = line.split(';').join(separator).split(separator);

  if (mode === 'auto' || mode === 'labeled') {
    for (const token of tokens) {
      const sepIndex = [':', '='].map((s) => token.indexOf(s)).find((i) => i >= 0);
      if (sepIndex === undefined) continue;
      const name = token.slice(0, sepIndex).trim();
      const value = toNumber(token.slice(sepIndex + 1));
      if (name && value !== null) out[name] = value;
    }
    if (Object.keys(out).length || mode === 'labeled') return out;
  }

  tokens.forEach((token, i) => {
    const value = toNumber(token);
    if (value !== null) out[t('graph.valueN', { n: i + 1 })] = value;
  });
  return out;
}
