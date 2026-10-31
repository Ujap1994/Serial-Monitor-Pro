// Line endings that can be appended to sent data.

export const NEWLINES = ['None', 'LF', 'CR', 'CRLF'] as const;
export type Newline = (typeof NEWLINES)[number];

export const NEWLINE_BYTES: Record<Newline, Uint8Array> = {
  None: new Uint8Array(),
  LF: Uint8Array.of(0x0a),
  CR: Uint8Array.of(0x0d),
  CRLF: Uint8Array.of(0x0d, 0x0a),
};

export function isNewline(value: unknown): value is Newline {
  return typeof value === 'string' && (NEWLINES as readonly string[]).includes(value);
}
