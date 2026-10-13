// Rendering of raw bytes and parsing of user input.

import { t } from '../i18n';
import { decodeUtf8, encodeUtf8, hex2 } from './bytes';

export const DATA_FORMATS = ['ASCII', 'HEX', 'DEC', 'BIN'] as const;
export type DataFormat = (typeof DATA_FORMATS)[number];

export function isDataFormat(value: unknown): value is DataFormat {
  return typeof value === 'string' && (DATA_FORMATS as readonly string[]).includes(value);
}

function printable(b: number): string {
  return b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
}

/** Converts raw bytes into the selected representation. */
export function formatBytes(raw: Uint8Array, mode: DataFormat, utf8 = false): string {
  switch (mode) {
    case 'HEX':
      return Array.from(raw, hex2).join(' ');
    case 'DEC':
      return Array.from(raw, (b) => String(b)).join(' ');
    case 'BIN':
      return Array.from(raw, (b) => b.toString(2).padStart(8, '0')).join(' ');
    case 'ASCII':
      return utf8 ? decodeUtf8(raw) : Array.from(raw, printable).join('');
  }
}

/** ASCII rendering that keeps line breaks and tabs so text stays readable. */
export function formatText(raw: Uint8Array, utf8: boolean): string {
  if (utf8) return decodeUtf8(raw);
  let out = '';
  for (const b of raw) {
    out += b === 0x0a || b === 0x0d || b === 0x09 ? String.fromCharCode(b) : printable(b);
  }
  return out;
}

/** Classic hex dump: offset | hex values | ASCII. */
export function hexdump(raw: Uint8Array, width = 16): string {
  const lines: string[] = [];
  for (let off = 0; off < raw.length; off += width) {
    const chunk = raw.subarray(off, off + width);
    const hexa = Array.from(chunk.subarray(0, 8), hex2).join(' ');
    const hexb = Array.from(chunk.subarray(8), hex2).join(' ');
    const hexpart =
      chunk.length > 8
        ? `${hexa.padEnd(23)}   ${hexb.padEnd(23)}`
        : `${hexa.padEnd(23)}${''.padEnd(26)}`;
    const text = Array.from(chunk, printable).join('');
    lines.push(`${off.toString(16).toUpperCase().padStart(8, '0')}  ${hexpart} |${text}|`);
  }
  return lines.join('\n');
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

const BASES: Record<Exclude<DataFormat, 'ASCII'>, { base: number; pattern: RegExp }> = {
  HEX: { base: 16, pattern: /^[0-9a-fA-F]+$/ },
  DEC: { base: 10, pattern: /^[0-9]+$/ },
  BIN: { base: 2, pattern: /^[01]+$/ },
};

/**
 * Converts the user's input into bytes.
 *
 * Deliberately lenient: separators such as spaces, commas, semicolons, dashes
 * and `0x` prefixes are accepted because hex values are copied from data
 * sheets in many notations. Values above 255 are rejected instead of being
 * silently truncated – whoever types 999 does not mean 231.
 */
export function parseSendData(text: string, fmt: DataFormat): Uint8Array {
  const input = (text ?? '').trim();
  if (!input) return new Uint8Array();
  if (fmt === 'ASCII') return encodeUtf8(input);

  const cleaned = input
    .replace(/0x/gi, ' ')
    .replace(/[,;\-\n\r\t]/g, ' ')
    .trim();
  let parts = cleaned.split(/\s+/).filter(Boolean);
  const { base, pattern } = BASES[fmt];

  // Accept contiguous strings such as "01AB03".
  if (fmt === 'HEX' && parts.length === 1) {
    const s = parts[0] ?? '';
    if (s.length > 2 && s.length % 2 === 0) {
      parts = s.match(/.{2}/g) ?? [];
    }
  }

  const out: number[] = [];
  for (const token of parts) {
    if (!pattern.test(token)) {
      throw new InputError(
        t('input.invalidToken', {
          token,
          label: t(`input.label.${fmt}`),
          allowed: t(`input.allowed.${fmt}`),
        }),
      );
    }
    const value = parseInt(token, base);
    if (value > 255) {
      throw new InputError(t('input.outOfRange', { token, value }));
    }
    out.push(value);
  }
  return Uint8Array.from(out);
}

export interface HexInputOptions {
  uppercase?: boolean;
  group?: boolean;
  groupSize?: number;
}

/**
 * Formats a hex input while typing, e.g. "0a1b2" → "0A 1B 2".
 *
 * The caret position is carried along: replacing the field content would
 * otherwise jump the caret to the end and mid-text edits would continue at
 * the wrong place.
 */
export function formatHexInput(
  text: string,
  cursor = -1,
  { uppercase = true, group = true, groupSize = 2 }: HexInputOptions = {},
): { text: string; cursor: number } {
  const caret = cursor < 0 ? text.length : cursor;
  let clean = '';
  let before = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (/[0-9a-fA-F]/.test(ch)) {
      clean += uppercase ? ch.toUpperCase() : ch.toLowerCase();
      if (i < caret) before++;
    }
  }
  if (!group || groupSize <= 0) {
    return { text: clean, cursor: Math.min(before, clean.length) };
  }
  const groups = clean.match(new RegExp(`.{1,${groupSize}}`, 'g')) ?? [];
  const out = groups.join(' ');
  const spaces = before ? Math.max(0, Math.floor((before - 1) / groupSize)) : 0;
  return { text: out, cursor: Math.min(before + spaces, out.length) };
}

export function normalizeHexDisplay(text: string, uppercase = true): string {
  return formatHexInput(text, -1, { uppercase }).text;
}

/**
 * Simple, predictable text search (no regular expressions): a typo in the
 * pattern should not swallow anything, it should simply not match.
 */
export function matchesFilter(line: string, pattern: string): boolean {
  if (!pattern) return true;
  return (line ?? '').toLowerCase().includes(pattern.toLowerCase());
}
