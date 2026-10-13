import { describe, expect, it } from 'vitest';
import { bestBaud, printableRatio, SCAN_BAUDS } from '@shared/core/baudscan';
import { ascii } from './helpers';

describe('baud rate scanner', () => {
  it('rates readable text', () => {
    expect(printableRatio(ascii('Hello\r\n'))).toBe(1);
    expect(printableRatio(Uint8Array.of(0xff, 0xfe, 0x41, 0x42))).toBe(0.5);
    expect(printableRatio(new Uint8Array())).toBe(0);
  });

  it('picks the most readable rate above 50 %', () => {
    const best = bestBaud([
      { baud: 4800, bytes: 100, ratio: 0.2 },
      { baud: 9600, bytes: 100, ratio: 0.98 },
      { baud: 19200, bytes: 0, ratio: null },
    ]);
    expect(best?.baud).toBe(9600);
  });

  it('returns nothing if no rate is clearly readable', () => {
    expect(bestBaud([{ baud: 9600, bytes: 100, ratio: 0.4 }])).toBeNull();
    expect(bestBaud([])).toBeNull();
  });

  it('covers the common rates', () => {
    expect(SCAN_BAUDS).toContain(9600);
    expect(SCAN_BAUDS).toContain(115200);
  });
});
