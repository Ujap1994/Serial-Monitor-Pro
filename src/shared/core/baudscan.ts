// Baud rate scanner: listens briefly at each rate and rates the readability.

export const SCAN_BAUDS = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 921600,
] as const;

export interface ScanResult {
  baud: number;
  bytes: number;
  /** Share of printable ASCII characters (0…1); null if nothing was received. */
  ratio: number | null;
  error?: string;
}

/** Share of printable characters including tab, CR and LF. */
export function printableRatio(data: Uint8Array): number {
  if (!data.length) return 0;
  let printable = 0;
  for (const b of data) {
    if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) printable++;
  }
  return printable / data.length;
}

/** Best result if it is clearly readable (more than 50 % printable). */
export function bestBaud(results: ScanResult[]): ScanResult | null {
  const candidates = results
    .filter((r) => r.ratio !== null && r.bytes > 0)
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || b.bytes - a.bytes);
  const best = candidates[0];
  return best && (best.ratio ?? 0) > 0.5 ? best : null;
}
