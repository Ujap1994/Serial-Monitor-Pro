import { describe, expect, it } from 'vitest';
import { calculateCrc, CRC_NAMES, crcSize, formatCrc } from '@shared/core/crc';
import { ascii, bytes } from './helpers';

// Official check values for the input "123456789" (CRC catalogue).
const OFFICIAL: Record<string, number> = {
  'CRC-8': 0xf4,
  'CRC-8/MAXIM': 0xa1,
  'CRC-8/SAE-J1850': 0x4b,
  'CRC-16/IBM': 0xbb3d,
  'CRC-16/MODBUS': 0x4b37,
  'CRC-16/CCITT-False': 0x29b1,
  'CRC-16/XMODEM': 0x31c3,
  'CRC-16/USB': 0xb4c8,
  'CRC-32': 0xcbf43926,
  'CRC-32/BZIP2': 0xfc891918,
  'CRC-32C': 0xe3069283,
};

describe('CRC engine', () => {
  it.each(Object.entries(OFFICIAL))('%s matches the official check value', (name, expected) => {
    expect(calculateCrc(ascii('123456789'), name)).toBe(expected);
  });

  it('offers exactly the 11 documented algorithms', () => {
    expect(CRC_NAMES).toHaveLength(11);
    expect(new Set(CRC_NAMES)).toEqual(new Set(Object.keys(OFFICIAL)));
  });

  it('handles empty data and unknown algorithms', () => {
    expect(calculateCrc(new Uint8Array(), 'CRC-16/MODBUS')).toBe(0xffff);
    expect(calculateCrc(ascii('x'), 'DOES-NOT-EXIST')).toBe(0);
  });

  it('reports the checksum size in bytes', () => {
    expect(crcSize('CRC-8')).toBe(1);
    expect(crcSize('CRC-16/MODBUS')).toBe(2);
    expect(crcSize('CRC-32C')).toBe(4);
    expect(crcSize('')).toBe(0);
  });

  it('formats values with the width of the algorithm', () => {
    expect(formatCrc(0x4b, 'CRC-8')).toBe('4B');
    expect(formatCrc(0x31c3, 'CRC-16/XMODEM')).toBe('31C3');
    expect(formatCrc(0x0a, 'CRC-32')).toBe('0000000A');
  });

  it('computes the Modbus example telegram', () => {
    // 01 03 00 00 00 0A → CRC C5 CD (little-endian on the wire)
    expect(calculateCrc(bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x0a), 'CRC-16/MODBUS')).toBe(0xcdc5);
  });
});
