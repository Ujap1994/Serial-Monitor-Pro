import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrateLegacySettings, normalizeSettings } from '@shared/core/settings';

describe('settings', () => {
  it('restores CRC settings without clamping invalid packet positions', () => {
    const transmitCrc = {
      enabled: true,
      algorithm: 'CRC-32',
      bigEndian: false,
      position: -999,
      useHeader: true,
      header: 'AA 55',
      useFooter: false,
      footer: '0D 0A',
      includeHeader: false,
      includeFooter: true,
    };
    expect(
      normalizeSettings(JSON.parse(JSON.stringify({ transmitCrc })) as unknown).transmitCrc,
    ).toEqual(transmitCrc);
    expect(
      normalizeSettings({ transmitCrc: { algorithm: 'unknown', enabled: 'yes', position: NaN } })
        .transmitCrc,
    ).toEqual(DEFAULT_SETTINGS.transmitCrc);
    expect(normalizeSettings({ transmitCrc: { position: 1.5 } }).transmitCrc.position).toBe(1.5);
  });

  it('keeps the periodic interval within 10 ms and one hour', () => {
    expect(normalizeSettings({}).periodicMs).toBe(1000);
    expect(normalizeSettings({ periodicMs: 250 }).periodicMs).toBe(250);
    expect(normalizeSettings({ periodicMs: 1 }).periodicMs).toBe(10);
    expect(normalizeSettings({ periodicMs: 9e9 }).periodicMs).toBe(3_600_000);
    expect(normalizeSettings({ periodicMs: 'fast' }).periodicMs).toBe(1000);
  });

  it('takes over CRC, header/footer and periodic sending of the CustomTkinter version', () => {
    const s = migrateLegacySettings({
      crc_on: true,
      crc_method: 'CRC-16/CCITT-False',
      crc_endian: 'Little-Endian',
      crc_position: 'Insert at index',
      crc_index: '-1',
      use_header: true,
      header: 'AA 55',
      use_footer: true,
      footer: '0D',
      crc_include_header: true,
      crc_include_footer: false,
      periodic_ms: '250',
      auto_scroll: false,
    });
    expect(s.transmitCrc).toEqual({
      enabled: true,
      algorithm: 'CRC-16/CCITT-False',
      bigEndian: false,
      position: -1,
      useHeader: true,
      header: 'AA 55',
      useFooter: true,
      footer: '0D',
      includeHeader: true,
      includeFooter: false,
    });
    expect(s.periodicMs).toBe(250);
    expect(s.autoscroll).toBe(false);
  });

  it.each([
    ['Append', '5', 0],
    ['Insert at index', '2', 2],
    ['Insert at index', '0', 0],
    ['Insert at index', 'x', 0],
    ['unknown', '3', 0],
  ])('maps Python position %s / index %s to %i', (mode, index, position) => {
    expect(
      migrateLegacySettings({ crc_position: mode, crc_index: index }).transmitCrc.position,
    ).toBe(position);
  });
  it('fills in defaults', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const s = normalizeSettings({ baud: 9600, display: 'HEX', theme: 'dark', hexGroupSize: 4 });
    expect(s.baud).toBe(9600);
    expect(s.display).toBe('HEX');
    expect(s.theme).toBe('dark');
    expect(s.hexGroupSize).toBe(4);
  });

  it('rejects invalid values', () => {
    const s = normalizeSettings({
      baud: 'fast',
      display: 'XYZ',
      theme: 'pink',
      fontSize: 500,
      dataBits: 9,
    });
    expect(s.baud).toBe(DEFAULT_SETTINGS.baud);
    expect(s.display).toBe(DEFAULT_SETTINGS.display);
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.fontSize).toBe(32);
    expect(s.dataBits).toBe(8);
  });

  it('keeps the defaults immutable', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it('migrates the settings of the former Python version', () => {
    const s = migrateLegacySettings({
      baud: '9600',
      bytesize: '7',
      parity: 'Even',
      stopbits: '2',
      display: 'HEX',
      show_crlf: true,
      deltatime: true,
      font_size: 12,
      timestamp_format: '%H:%M:%S',
      send_format: 'ASCII',
      hex_group_size: 4,
      language: 'de',
      // obsolete licence information must simply be ignored
      license_key: 'XXXX',
    });
    expect(s).toMatchObject({
      baud: 9600,
      dataBits: 7,
      parity: 'Even',
      stopBits: '2',
      display: 'HEX',
      showCrlf: true,
      deltaTime: true,
      fontSize: 16,
      timestampFormat: 'time',
      sendFormat: 'ASCII',
      hexGroupSize: 4,
      language: 'de',
    });
    expect(s).not.toHaveProperty('license_key');
  });
});

describe('settings for flow control, file sending and updates', () => {
  it('accepts valid values', () => {
    const s = normalizeSettings({
      flowControl: 'rtscts',
      dtr: false,
      rts: false,
      updateCheck: false,
      updateSkipped: '1.2.3',
      fileSend: { mode: 'lines', blockSize: 128, pauseMs: 250 },
    });
    expect(s).toMatchObject({
      flowControl: 'rtscts',
      dtr: false,
      rts: false,
      updateCheck: false,
      updateSkipped: '1.2.3',
      fileSend: { mode: 'lines', blockSize: 128, pauseMs: 250 },
    });
  });

  it('falls back to safe defaults for unknown or out-of-range values', () => {
    const s = normalizeSettings({
      flowControl: 'magic',
      dtr: 'yes',
      fileSend: { mode: 'chunks', blockSize: 100000, pauseMs: -5 },
    });
    expect(s.flowControl).toBe('none');
    expect(s.dtr).toBe(true);
    expect(s.rts).toBe(true);
    expect(s.updateCheck).toBe(true);
    expect(s.fileSend).toEqual({ mode: 'blocks', blockSize: 4096, pauseMs: 0 });
  });
});
