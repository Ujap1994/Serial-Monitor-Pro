import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import {
  commandBytes,
  commandPreview,
  newCommand,
  normalizeCommand,
  parseCommandFile,
  serializeCommands,
  validateCommand,
} from '@shared/core/commands';
import { describeStep, newStep, normalizeStep } from '@shared/core/steps';

beforeAll(() => setLanguage('de'));

const C = (
  name: string,
  data: string,
  fmt: 'ASCII' | 'HEX' = 'HEX',
  newline: 'None' | 'LF' | 'CR' | 'CRLF' = 'LF',
) => newCommand({ name, data, fmt, newline });

describe('commands', () => {
  it('appends the line ending', () => {
    expect(Array.from(commandBytes(C('x', 'AT', 'ASCII', 'CRLF')))).toEqual([
      0x41, 0x54, 0x0d, 0x0a,
    ]);
    expect(Array.from(commandBytes(C('x', 'AT', 'ASCII', 'None')))).toEqual([0x41, 0x54]);
    expect(Array.from(commandBytes(C('x', '01 03', 'HEX', 'None')))).toEqual([0x01, 0x03]);
  });

  it('validates name and data', () => {
    expect(validateCommand(C('', '01')).ok).toBe(false);
    expect(validateCommand(C('', '01')).error).toContain('Name');
    expect(validateCommand(C('A', 'ZZ')).ok).toBe(false);
    expect(validateCommand(C('A', '01')).ok).toBe(true);
  });

  it('previews the bytes that will be sent', () => {
    expect(commandPreview(C('A', 'ZZ'))).toMatch(/^⚠/);
    expect(commandPreview(C('A', '01 02 03', 'HEX', 'None'))).toContain('(3 B)');
    expect(commandPreview(C('A', '', 'HEX', 'None'))).toBe('—');
    expect(commandPreview(C('A', '00 '.repeat(20), 'HEX', 'None'))).toContain('…');
  });

  it('round-trips through the export format', () => {
    const list = [C('A', '01'), { ...C('B', '02'), delayMs: 250, enabled: false }];
    const back = parseCommandFile(serializeCommands(list));
    expect(back).toEqual(list);
  });

  it('imports files of the former Python version', () => {
    const legacy =
      '[{"name":"Alt","data":"AT","fmt":"ASCII","newline":"CRLF","delay_ms":250,"enabled":false}]';
    expect(parseCommandFile(legacy)[0]).toEqual({
      name: 'Alt',
      data: 'AT',
      fmt: 'ASCII',
      newline: 'CRLF',
      delayMs: 250,
      enabled: false,
    });
  });

  it('rejects files without a command list', () => {
    expect(() => parseCommandFile('{"kein":"array"}')).toThrow();
    expect(() => parseCommandFile('not json')).toThrow();
  });

  it('repairs invalid fields', () => {
    expect(normalizeCommand({ name: 1, fmt: 'XYZ', newline: '??', delayMs: -5 })).toEqual({
      name: '1',
      data: '',
      fmt: 'HEX',
      newline: 'LF',
      delayMs: 200,
      enabled: true,
    });
  });
});

describe('automation steps', () => {
  const steps = [
    newStep({ kind: 'send', data: 'AT', fmt: 'ASCII', newline: 'CRLF' }),
    newStep({ kind: 'expect', data: 'OK', fmt: 'ASCII', value: 2000 }),
    newStep({ kind: 'wait', value: 500 }),
    newStep({ kind: 'log', note: 'Runde fertig' }),
  ];

  it('describes every kind of step', () => {
    expect(describeStep(steps[0]!)).toContain('Senden');
    expect(describeStep(steps[1]!)).toContain('Erwarten');
    expect(describeStep(steps[2]!)).toContain('500 ms');
    expect(describeStep(steps[3]!)).toContain('Runde fertig');
  });

  it('keeps all fields when stored', () => {
    const back = JSON.parse(JSON.stringify(steps)).map(normalizeStep);
    expect(back).toEqual(steps);
  });

  it('repairs unknown kinds', () => {
    expect(normalizeStep({ kind: 'fly', value: 'x' }).kind).toBe('send');
    expect(normalizeStep({ kind: 'fly', value: 'x' }).value).toBe(500);
  });
});
