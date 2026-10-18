import { describe, expect, it } from 'vitest';
import { fileStamp, formatTimestamp } from '@shared/core/timestamp';

// Local time, so the expectations hold in every time zone.
const t = new Date(2026, 9, 3, 7, 5, 9, 42).getTime();

describe('formatTimestamp', () => {
  it.each([
    ['time-ms', '07:05:09.042'],
    ['time', '07:05:09'],
    ['datetime', '2026-10-03 07:05:09'],
    ['date-short', '03.10. 07:05:09'],
  ] as const)('%s', (fmt, expected) => {
    expect(formatTimestamp(t, fmt)).toBe(expected);
  });
});

describe('fileStamp', () => {
  it('produces a sortable name without separators that file systems reject', () => {
    expect(fileStamp(t)).toBe('2026-10-03_070509');
    expect(fileStamp()).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}$/);
  });
});
