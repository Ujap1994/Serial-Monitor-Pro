// Extraction of measurement values for the live graph.

import { t } from '../i18n';

export type ExtractMode = 'auto' | 'labeled' | 'separated';

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function toNumber(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!NUMBER.test(s)) return null;
  // "1e999" matches the pattern but would put Infinity into the graph.
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
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

export interface SeriesStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  /** Population standard deviation. */
  stddev: number;
  median: number;
  range: number;
}

/** Statistics of the kept values of one curve (as in the Python version). */
export function seriesStats(values: readonly number[]): SeriesStats | null {
  const n = values.length;
  if (!n) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median =
    n % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return { count: n, min, max, mean, stddev: Math.sqrt(sq / n), median, range: max - min };
}

/**
 * CSV of all curves. The newest values of all curves share the last row – the
 * same alignment as in the plot; shorter curves have empty cells at the top.
 */
export function seriesCsv(
  series: ReadonlyMap<string, readonly number[]>,
  indexHeader: string,
): string {
  const names = [...series.keys()];
  const longest = Math.max(0, ...[...series.values()].map((v) => v.length));
  const cell = (text: string): string =>
    /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  const rows = [[indexHeader, ...names].map(cell).join(';')];
  for (let i = 0; i < longest; i++) {
    const row = [String(i)];
    for (const name of names) {
      const v = series.get(name) ?? [];
      const value = v[i - (longest - v.length)];
      row.push(value === undefined ? '' : String(value));
    }
    rows.push(row.join(';'));
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
