// Interactive terminal: what a key press sends to the device.

import { encodeUtf8 } from './bytes';

export const TERMINAL_ENTER = ['CR', 'LF', 'CRLF'] as const;
export type TerminalEnter = (typeof TERMINAL_ENTER)[number];

const ENTER: Record<TerminalEnter, string> = { CR: '\r', LF: '\n', CRLF: '\r\n' };

/**
 * Bytes for the input of the terminal (xterm.js reports Enter as CR, Backspace
 * as DEL, arrows and function keys as escape sequences, Ctrl+C as 0x03 …).
 * Only Enter is translated – consoles differ in the line end they expect.
 */
export function terminalBytes(input: string, enter: TerminalEnter): Uint8Array {
  return encodeUtf8(enter === 'CR' ? input : input.replace(/\r/g, ENTER[enter]));
}

/** What a local echo shows for typed input: a new line for Enter, nothing for control keys. */
export function localEcho(input: string): string {
  if (input.startsWith('\x1b')) return '';
  return (
    input
      .replace(/\r/g, '\r\n')
      .replace(/\x7f/g, '\b \b')
      // eslint-disable-next-line no-control-regex -- control keys are exactly what is removed
      .replace(/[\x00-\x07\x0e-\x1f]/g, '')
  );
}
