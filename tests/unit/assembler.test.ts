import { describe, expect, it } from 'vitest';
import { StreamAssembler, MAX_ENTRY_BYTES } from '@shared/core/assembler';
import { ascii } from './helpers';

const text = (data: Uint8Array): string => new TextDecoder().decode(data);

describe('StreamAssembler (newline mode)', () => {
  it('joins pieces of a line', () => {
    const a = new StreamAssembler('newline', 100);
    expect(a.push({ t: 0, data: ascii('Hel') })).toEqual([]);
    const out = a.push({ t: 5, data: ascii('lo\nWor') });
    expect(out.map((e) => text(e.data))).toEqual(['Hello\n']);
    expect(out[0]?.t).toBe(0);
    expect(a.pending).toBe(true);
  });

  it('splits several lines in one chunk', () => {
    const a = new StreamAssembler('newline', 100);
    const out = a.push({ t: 0, data: ascii('a\r\nb\nc\r\n') });
    expect(out.map((e) => text(e.data))).toEqual(['a\r\n', 'b\n', 'c\r\n']);
  });

  it('ends lines on a lone CR', () => {
    const a = new StreamAssembler('newline', 100);
    const out = a.push({ t: 0, data: ascii('one\rtwo\r') });
    expect(out.map((e) => text(e.data))).toEqual(['one\r']);
    expect(text(a.flushAll()!.data)).toBe('two\r');
  });

  it('flushes incomplete lines after the timeout', () => {
    const a = new StreamAssembler('newline', 100);
    a.push({ t: 0, data: ascii('prompt> ') });
    expect(a.flush(50)).toBeNull();
    expect(text(a.flush(100)!.data)).toBe('prompt> ');
  });

  it('starts a new entry after a pause', () => {
    const a = new StreamAssembler('newline', 100);
    a.push({ t: 0, data: ascii('A') });
    const out = a.push({ t: 500, data: ascii('B\n') });
    expect(out.map((e) => text(e.data))).toEqual(['A', 'B\n']);
  });

  it('limits the size of an entry', () => {
    const a = new StreamAssembler('newline', 100);
    const out = a.push({ t: 0, data: new Uint8Array(MAX_ENTRY_BYTES + 10).fill(0x41) });
    expect(out).toHaveLength(1);
    expect(out[0]?.data).toHaveLength(MAX_ENTRY_BYTES);
  });
});

describe('StreamAssembler (packet mode)', () => {
  it('groups data until a pause', () => {
    const a = new StreamAssembler('packet', 20);
    expect(a.push({ t: 0, data: Uint8Array.of(1, 2) })).toEqual([]);
    expect(a.push({ t: 5, data: Uint8Array.of(3, 0x0a, 4) })).toEqual([]);
    const out = a.push({ t: 100, data: Uint8Array.of(9) });
    expect(Array.from(out[0]?.data ?? [])).toEqual([1, 2, 3, 0x0a, 4]);
    expect(Array.from(a.flushAll()?.data ?? [])).toEqual([9]);
  });
});
