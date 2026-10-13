// Timestamp formats offered in the settings.

export const TIMESTAMP_FORMATS = ['time-ms', 'time', 'datetime', 'date-short'] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMATS)[number];

const p2 = (n: number): string => String(n).padStart(2, '0');

export function formatTimestamp(epochMs: number, fmt: TimestampFormat): string {
  const d = new Date(epochMs);
  const time = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  switch (fmt) {
    case 'time-ms':
      return `${time}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    case 'time':
      return time;
    case 'datetime':
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${time}`;
    case 'date-short':
      return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}. ${time}`;
  }
}

/** File-name friendly stamp: 2026-10-13_174512 */
export function fileStamp(epochMs = Date.now()): string {
  const d = new Date(epochMs);
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_` +
    `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  );
}
