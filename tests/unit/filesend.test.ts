import { describe, expect, it } from 'vitest';
import { concatBytes } from '@shared/core/bytes';
import { estimateSeconds, splitForSending } from '@shared/core/filesend';
import { ascii } from './helpers';

const hex = (pieces: Uint8Array[]): string[] =>
  pieces.map((p) => new TextDecoder().decode(p).replace(/\n/g, '⏎'));

describe('splitForSending', () => {
  it('cuts fixed-size blocks', () => {
    expect(hex(splitForSending(ascii('abcdefg'), 'blocks', 3))).toEqual(['abc', 'def', 'g']);
  });

  it('sends one line per piece, line end included', () => {
    expect(hex(splitForSending(ascii('G1 X1\nG1 Y2\nM2'), 'lines', 64))).toEqual([
      'G1 X1⏎',
      'G1 Y2⏎',
      'M2',
    ]);
  });

  it('splits lines that are longer than the block size', () => {
    expect(hex(splitForSending(ascii('abcdef\nxy\n'), 'lines', 4))).toEqual(['abcd', 'ef⏎', 'xy⏎']);
  });

  it('never loses or reorders a byte (random data, sizes and modes)', () => {
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let n = 0; n < 300; n++) {
      const data = Uint8Array.from({ length: rnd(3000) }, () => (rnd(8) === 0 ? 0x0a : rnd(256)));
      const size = 1 + rnd(300);
      const mode = rnd(2) ? 'lines' : 'blocks';
      const pieces = splitForSending(data, mode, size);
      expect(Buffer.from(concatBytes(...pieces)).equals(Buffer.from(data)), `case ${n}`).toBe(true);
      expect(
        pieces.every((p) => p.length >= 1 && p.length <= size),
        `case ${n}`,
      ).toBe(true);
    }
  });

  it('returns nothing for an empty file', () => {
    expect(splitForSending(new Uint8Array(), 'blocks', 64)).toEqual([]);
  });
});

describe('estimateSeconds', () => {
  it('adds the time on the wire and the pauses', () => {
    // 960 bytes at 9600 baud = 1 s, plus 9 pauses of 100 ms
    expect(estimateSeconds(960, 10, 9600, 100)).toBeCloseTo(1.9);
  });
});
