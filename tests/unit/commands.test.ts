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
import { DEFAULT_TRANSMIT_CRC } from '@shared/core/transmit-crc';

beforeAll(() => setLanguage('de'));

const C = (
  name: string,
  data: string,
  fmt: 'ASCII' | 'HEX' = 'HEX',
  newline: 'None' | 'LF' | 'CR' | 'CRLF' = 'LF',
) => newCommand({ name, data, fmt, newline });

describe('commands with "Append CRC" (add_crc of the Python presets)', () => {
  const crc = {
    ...DEFAULT_TRANSMIT_CRC,
    bigEndian: false,
    // Monitor-only options must not reach presets.
    enabled: false,
    useHeader: true,
    header: 'AA',
    useFooter: true,
    footer: 'BB',
    includeHeader: true,
  };

  it('inserts the CRC before the line ending, without Monitor header/footer', () => {
    const cmd = newCommand({ data: '01 03 00 00 00 0A', newline: 'CRLF', addCrc: true });
    expect(Array.from(commandBytes(cmd, crc))).toEqual([
      0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd, 0x0d, 0x0a,
    ]);
    expect(Array.from(commandBytes(cmd, { ...crc, position: -1 }))).toEqual([
      0x01, 0x03, 0x00, 0x00, 0x00, 0xc5, 0xcd, 0x0a, 0x0d, 0x0a,
    ]);
  });

  it('leaves commands without the option and empty commands untouched', () => {
    expect(Array.from(commandBytes(newCommand({ data: '01', newline: 'None' }), crc))).toEqual([
      0x01,
    ]);
    expect(
      Array.from(commandBytes(newCommand({ data: '', newline: 'LF', addCrc: true }), crc)),
    ).toEqual([0x0a]);
  });

  it('validates and previews with the CRC, and reports impossible positions', () => {
    const cmd = newCommand({ name: 'R', data: '01 03', newline: 'None', addCrc: true });
    expect(commandPreview(cmd, crc)).toContain('(4 B)');
    expect(validateCommand(cmd, { ...crc, position: 5 }).ok).toBe(false);
  });

  it('reads description and periodic_ms of Python presets and clamps the interval', () => {
    const cmd = normalizeCommand({ name: 'a', description: 'Status', periodic_ms: '250' });
    expect(cmd.description).toBe('Status');
    expect(cmd.periodicMs).toBe(250);
    expect(normalizeCommand({ periodicMs: 1 }).periodicMs).toBe(10);
    expect(normalizeCommand({ periodicMs: 1e12 }).periodicMs).toBe(3_600_000);
    expect(normalizeCommand({}).periodicMs).toBe(1000);
  });

  it('reads add_crc from Python exports and addCrc from own exports', () => {
    expect(normalizeCommand({ name: 'a', add_crc: true }).addCrc).toBe(true);
    expect(normalizeCommand({ name: 'a', addCrc: true }).addCrc).toBe(true);
    expect(normalizeCommand({ name: 'a', addCrc: 'yes' }).addCrc).toBe(false);
    expect(normalizeCommand({ name: 'a' }).addCrc).toBe(false);
  });
});

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
      addCrc: false,
      description: '',
      periodicMs: 1000,
      sequence: false,
      steps: [],
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
      addCrc: false,
      description: '',
      periodicMs: 1000,
      sequence: false,
      steps: [],
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
