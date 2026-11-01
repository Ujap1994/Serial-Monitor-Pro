// Python parity added in 1.2.0: sequence presets, graph channels with own
// patterns and colours, and the folder settings.
import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import {
  commandBytes,
  commandParts,
  commandPreview,
  newCommand,
  normalizeCommand,
  validateCommand,
} from '@shared/core/commands';
import { migrateLegacySettings, normalizeSettings } from '@shared/core/settings';
import { DEFAULT_TRANSMIT_CRC } from '@shared/core/transmit-crc';
import { channelPatternError, extractChannels, type GraphChannel } from '@shared/core/values';
import { hex } from './helpers';

beforeAll(() => setLanguage('en'));

describe('sequence presets of the Python version', () => {
  const python = {
    name: 'Init',
    format: 'ASCII',
    data: '',
    description: 'Wake up and read the version',
    periodic_ms: 2500,
    add_crc: false,
    is_sequence: true,
    steps: [
      { data: 'AT', format: 'ASCII', pause_ms: 200 },
      { data: '01 03', format: 'HEX', pause_ms: '0' },
    ],
  };

  it('imports is_sequence, steps with format and pause_ms, and the preset "format"', () => {
    const cmd = normalizeCommand(python);
    expect(cmd).toMatchObject({
      name: 'Init',
      fmt: 'ASCII',
      sequence: true,
      periodicMs: 2500,
      description: 'Wake up and read the version',
      steps: [
        { data: 'AT', fmt: 'ASCII', pauseMs: 200 },
        { data: '01 03', fmt: 'HEX', pauseMs: 0 },
      ],
    });
    // A plain Python preset keeps its format (it was read as HEX before).
    expect(normalizeCommand({ name: 'x', format: 'DEC', data: '65' }).fmt).toBe('DEC');
  });

  it('sends every step with the line ending and its pause', () => {
    const cmd = normalizeCommand({ ...python, newline: 'CRLF' });
    expect(commandParts(cmd)).toEqual([
      { data: hex('41 54 0D 0A'), pauseMs: 200 },
      { data: hex('01 03 0D 0A'), pauseMs: 0 },
    ]);
    expect(commandBytes(cmd)).toEqual(hex('41 54 0D 0A 01 03 0D 0A'));
    expect(commandPreview(cmd)).toContain('2 steps');
  });

  it('appends the CRC to every step when "Append CRC" is set', () => {
    const cmd = newCommand({
      sequence: true,
      addCrc: true,
      newline: 'None',
      steps: [{ data: '01 03 00 00 00 0A', fmt: 'HEX', pauseMs: 0 }],
    });
    expect(commandParts(cmd, { ...DEFAULT_TRANSMIT_CRC, bigEndian: false })[0]?.data).toEqual(
      hex('01 03 00 00 00 0A C5 CD'),
    );
  });

  it('reports the failing step and an empty sequence', () => {
    const bad = newCommand({
      name: 'S',
      sequence: true,
      steps: [
        { data: '01', fmt: 'HEX', pauseMs: 0 },
        { data: 'ZZ', fmt: 'HEX', pauseMs: 0 },
      ],
    });
    expect(validateCommand(bad).error).toMatch(/^Step 2:/);
    expect(validateCommand(newCommand({ name: 'S', sequence: true })).error).toBe(
      'The sequence has no steps yet.',
    );
  });

  it('limits pauses and the number of steps', () => {
    const many = normalizeCommand({
      is_sequence: true,
      steps: Array.from({ length: 600 }, () => ({ data: 'A', pause_ms: 9e9 })),
    });
    expect(many.steps).toHaveLength(500);
    expect(many.steps[0]?.pauseMs).toBe(600_000);
  });
});

describe('graph channels with own patterns', () => {
  const ch = (patch: Partial<GraphChannel>): GraphChannel => ({
    name: 'Temp',
    pattern: 'Temp:\\s*(-?\\d+(?:[.,]\\d+)?)',
    color: '#ff0000',
    enabled: true,
    ...patch,
  });

  it('takes the first group of each channel, also with decimal commas', () => {
    expect(
      extractChannels('Temp: 23,5 Hum=48', [ch({}), ch({ name: 'Hum', pattern: 'Hum=(\\d+)' })]),
    ).toEqual({ Temp: 23.5, Hum: 48 });
  });

  it('uses the whole match without a group and skips disabled, unnamed or broken channels', () => {
    expect(extractChannels('value 42', [ch({ name: 'All', pattern: '\\d+' })])).toEqual({
      All: 42,
    });
    expect(
      extractChannels('Temp: 1', [
        ch({ enabled: false }),
        ch({ name: ' ' }),
        ch({ name: 'X', pattern: '(' }),
      ]),
    ).toEqual({});
    expect(extractChannels('Temp: abc', [ch({ pattern: 'Temp: (\\w+)' })])).toEqual({});
  });

  it('validates patterns', () => {
    expect(channelPatternError('Temp:(\\d+)')).toBe('');
    expect(channelPatternError('')).toBe('empty');
    expect(channelPatternError('(')).not.toBe('');
  });

  it('stores channels and colours safely in the settings', () => {
    const s = normalizeSettings({
      graph: {
        mode: 'regex',
        channels: [{ name: 'Temp', pattern: 'T=(\\d+)', color: 'red' }],
        colors: { Temp: '#00ff00', Bad: 'javascript:alert(1)' },
      },
    });
    expect(s.graph.mode).toBe('regex');
    expect(s.graph.channels).toEqual([
      { name: 'Temp', pattern: 'T=(\\d+)', color: '#3b82f6', enabled: true },
    ]);
    expect(s.graph.colors).toEqual({ Temp: '#00ff00' });
  });
});

describe('folder settings', () => {
  it('default to the application folders and are trimmed', () => {
    expect(normalizeSettings({}).paths).toEqual({ dataDir: '', logDir: '' });
    expect(normalizeSettings({ paths: { dataDir: ' /data ', logDir: 5 } }).paths).toEqual({
      dataDir: '/data',
      logDir: '',
    });
  });

  it('take over the Python log path', () => {
    expect(migrateLegacySettings({ log_path: '/home/me/logs' }).paths.logDir).toBe('/home/me/logs');
  });
});
