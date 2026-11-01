import { describe, expect, it } from 'vitest';
import { hasAnsi, parseAnsi, stripAnsi } from '@shared/core/ansi';

const ESC = '\x1b';

describe('ANSI escape sequences', () => {
  it('leaves text without escape sequences alone', () => {
    expect(hasAnsi('plain')).toBe(false);
    expect(parseAnsi('plain')).toEqual([{ text: 'plain', style: null }]);
    expect(parseAnsi('')).toEqual([]);
  });

  it('turns an ESP-IDF log line into coloured text', () => {
    // I (312) wifi: connected – green, then reset
    const line = `${ESC}[0;32mI (312) wifi: connected${ESC}[0m`;
    expect(parseAnsi(line)).toEqual([{ text: 'I (312) wifi: connected', style: { fg: 2 } }]);
    expect(stripAnsi(line)).toBe('I (312) wifi: connected');
  });

  it('knows bright, background, bold, 256 and true colours', () => {
    const segments = parseAnsi(
      `${ESC}[1;91mERR${ESC}[22;39m ok ${ESC}[44mbg${ESC}[49m ${ESC}[38;5;196mred${ESC}[38;2;0;128;255mrgb${ESC}[m.`,
    );
    expect(segments).toEqual([
      { text: 'ERR', style: { bold: true, fg: 9 } },
      { text: ' ok ', style: null },
      { text: 'bg', style: { bg: 4 } },
      { text: ' ', style: null },
      { text: 'red', style: { fg: '#ff0000' } },
      { text: 'rgb', style: { fg: '#0080ff' } },
      { text: '.', style: null },
    ]);
  });

  it('removes cursor movement, erasing and window titles', () => {
    const line = `${ESC}[2K${ESC}[1Gprogress 50%${ESC}]0;title${ESC}\\${ESC}[?25l done${ESC}7`;
    expect(stripAnsi(line)).toBe('progress 50% done');
    expect(parseAnsi(line)).toEqual([{ text: 'progress 50% done', style: null }]);
  });

  it('keeps a lone escape at the end from breaking the line', () => {
    expect(stripAnsi(`abc${ESC}`)).toBe('abc');
    expect(stripAnsi(`abc${ESC}[3`)).toBe('abc3');
  });
});
