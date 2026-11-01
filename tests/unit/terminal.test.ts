import { describe, expect, it } from 'vitest';
import { localEcho, terminalBytes } from '@shared/core/terminal';

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('interactive terminal input', () => {
  it('sends Enter as the line end the device expects', () => {
    expect(text(terminalBytes('ls\r', 'CR'))).toBe('ls\r');
    expect(text(terminalBytes('ls\r', 'LF'))).toBe('ls\n');
    expect(text(terminalBytes('ls\r', 'CRLF'))).toBe('ls\r\n');
  });

  it('passes control keys and escape sequences through unchanged', () => {
    expect(Array.from(terminalBytes('\x03', 'LF'))).toEqual([3]); // Ctrl+C
    expect(Array.from(terminalBytes('\x7f', 'LF'))).toEqual([0x7f]); // Backspace
    expect(text(terminalBytes('\x1b[A', 'CRLF'))).toBe('\x1b[A'); // arrow up
    expect(Array.from(terminalBytes('ä', 'CR'))).toEqual([0xc3, 0xa4]); // UTF-8
  });

  it('echoes typed text locally, with a new line for Enter and erasing for Backspace', () => {
    expect(localEcho('help\r')).toBe('help\r\n');
    expect(localEcho('\x7f')).toBe('\b \b');
    expect(localEcho('\x1b[A')).toBe('');
    expect(localEcho('\x03')).toBe('');
  });
});
