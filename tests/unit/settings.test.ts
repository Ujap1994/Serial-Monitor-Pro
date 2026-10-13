import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrateLegacySettings, normalizeSettings } from '@shared/core/settings';

describe('settings', () => {
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
