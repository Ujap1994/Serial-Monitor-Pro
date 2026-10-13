import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import {
  formatBytes,
  formatHexInput,
  formatText,
  hexdump,
  InputError,
  matchesFilter,
  normalizeHexDisplay,
  parseSendData,
  type DataFormat,
} from '@shared/core/format';
import { ascii, bytes } from './helpers';

beforeAll(() => setLanguage('de'));

describe('formatBytes', () => {
  const raw = bytes(0x41, 0x42, 0x00, 0xff);
  it('renders HEX, DEC and BIN', () => {
    expect(formatBytes(raw, 'HEX')).toBe('41 42 00 FF');
    expect(formatBytes(raw, 'DEC')).toBe('65 66 0 255');
    expect(formatBytes(raw, 'BIN')).toBe('01000001 01000010 00000000 11111111');
  });
  it('replaces non-printable characters in ASCII', () => {
    expect(formatBytes(raw, 'ASCII')).toBe('AB..');
  });
  it('decodes UTF-8 on request', () => {
    expect(formatBytes(ascii('äöü'), 'ASCII', true)).toBe('äöü');
  });
  it('handles empty input', () => {
    expect(formatBytes(new Uint8Array(), 'HEX')).toBe('');
  });
  it('keeps line breaks and tabs in text mode', () => {
    expect(formatText(bytes(0x41, 0x09, 0x42, 0x0d, 0x0a, 0x01), false)).toBe('A\tB\r\n.');
  });
});

describe('hexdump', () => {
  it('shows offset, hex and ASCII column', () => {
    const dump = hexdump(ascii('Hello World!'));
    expect(dump.startsWith('00000000')).toBe(true);
    expect(dump).toContain('|Hello World!|');
  });
  it('wraps after 16 bytes', () => {
    const dump = hexdump(ascii('A'.repeat(17)));
    expect(dump.split('\n')).toHaveLength(2);
    expect(dump).toContain('00000010');
  });
  it('keeps the columns aligned', () => {
    const lines = hexdump(ascii('A'.repeat(20))).split('\n');
    expect(lines[0]?.indexOf('|')).toBe(lines[1]?.indexOf('|'));
  });
  it('treats edge values as non-printable', () => {
    expect(hexdump(bytes(0x00, 0x7f, 0x80, 0xff))).toContain('|....|');
  });
  it('returns an empty string for empty input', () => {
    expect(hexdump(new Uint8Array())).toBe('');
  });
});

describe('parseSendData', () => {
  it.each<[string, DataFormat, number[] | string]>([
    ['41 42', 'HEX', [0x41, 0x42]],
    ['0x41 0x42', 'HEX', [0x41, 0x42]],
    ['0X41,0x42', 'HEX', [0x41, 0x42]],
    ['41,42', 'HEX', [0x41, 0x42]],
    ['41-42', 'HEX', [0x41, 0x42]],
    ['41;42', 'HEX', [0x41, 0x42]],
    ['4142', 'HEX', [0x41, 0x42]],
    ['65 66', 'DEC', [65, 66]],
    ['01000001', 'BIN', [0x41]],
    ['Hallo', 'ASCII', 'Hallo'],
    ['', 'HEX', []],
    ['   ', 'HEX', []],
  ])('%j as %s', (text, fmt, expected) => {
    const result = parseSendData(text, fmt);
    expect(Array.from(result)).toEqual(
      typeof expected === 'string' ? Array.from(ascii(expected)) : expected,
    );
  });

  it.each<[string, DataFormat]>([
    ['ZZ', 'HEX'],
    ['999', 'DEC'],
    ['012', 'BIN'],
    ['256', 'DEC'],
    ['100000000', 'BIN'],
    ['123', 'HEX'],
  ])('rejects %j as %s instead of truncating', (text, fmt) => {
    expect(() => parseSendData(text, fmt)).toThrow(InputError);
  });

  it('explains the problem in plain language', () => {
    expect(() => parseSendData('999', 'DEC')).toThrow(/0 bis 255/);
    expect(() => parseSendData('ZZ', 'HEX')).toThrow(/keine gültige Hexadezimalzahl/);
  });
});

describe('formatHexInput', () => {
  const f = (text: string, opts = {}) => formatHexInput(text, -1, opts).text;
  it('upper-cases and groups while typing', () => {
    expect(f('0a1b')).toBe('0A 1B');
    expect(f('0a1b2c')).toBe('0A 1B 2C');
    expect(f('0a1')).toBe('0A 1');
  });
  it('respects the options', () => {
    expect(f('0A1B', { uppercase: false })).toBe('0a 1b');
    expect(f('0a1b', { group: false })).toBe('0A1B');
    expect(f('0a1b2c3d', { groupSize: 4 })).toBe('0A1B 2C3D');
  });
  it.each(['0a-1b', '0a,1b', '0a  1b', '0A1B'])('normalises separators in %j', (text) => {
    expect(f(text)).toBe('0A 1B');
  });
  it('drops invalid characters', () => {
    expect(f('XY 0a')).toBe('0A');
    expect(f('')).toBe('');
  });
  it('keeps the result sendable', () => {
    expect(Array.from(parseSendData(f('0a1b2c'), 'HEX'))).toEqual([0x0a, 0x1b, 0x2c]);
  });
  it('keeps the caret in range and after the typed character', () => {
    for (const text of ['0', '0a', '0a1', '0a1b', '0a1b2']) {
      const out = formatHexInput(text);
      expect(out.cursor).toBeGreaterThanOrEqual(0);
      expect(out.cursor).toBeLessThanOrEqual(out.text.length);
    }
    // typing "F" after "0A" in "0A 1B" → "0A F1 B", caret after F
    const out = formatHexInput('0AF 1B', 3);
    expect(out.text).toBe('0A F1 B');
    expect(out.text.slice(0, out.cursor)).toBe('0A F');
  });
  it('normalises existing text', () => {
    expect(normalizeHexDisplay('0a1b')).toBe('0A 1B');
  });
});

describe('matchesFilter', () => {
  it('matches case-insensitively without regular expressions', () => {
    expect(matchesFilter('Temp:23.5', 'temp')).toBe(true);
    expect(matchesFilter('Temp:23.5', '[')).toBe(false);
    expect(matchesFilter('anything', '')).toBe(true);
  });
});
