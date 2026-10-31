import { describe, expect, it } from 'vitest';
import { InputError, type DataFormat } from '@shared/core/format';
import {
  buildTransmitPacket,
  crcInsertionIndex,
  DEFAULT_TRANSMIT_CRC,
  framingBytes,
  insertCrc,
  monitorPacket,
  monitorSendBytes,
  packetBytes,
  type TransmitCrcConfig,
} from '@shared/core/transmit-crc';
import { ascii, hex } from './helpers';

const config = (patch: Partial<TransmitCrcConfig> = {}): TransmitCrcConfig => ({
  ...DEFAULT_TRANSMIT_CRC,
  enabled: true,
  ...patch,
});

// Expected bytes come from an independent Python reference (zlib.crc32 and a
// bitwise Modbus CRC, inserted with Python slicing data[:i] + crc + data[i:]),
// never from the CRC engine under test.
const CHECK_VECTORS = [
  {
    algorithm: 'CRC-8',
    bigEndian: false,
    value: 0xf4,
    crc: 'F4',
    packets: {
      0: '31 32 33 34 35 36 37 38 39 F4',
      1: '31 F4 32 33 34 35 36 37 38 39',
      [-1]: '31 32 33 34 35 36 37 38 F4 39',
      [-2]: '31 32 33 34 35 36 37 F4 38 39',
    },
  },
  {
    algorithm: 'CRC-16/MODBUS',
    bigEndian: false,
    value: 0x4b37,
    crc: '37 4B',
    packets: {
      0: '31 32 33 34 35 36 37 38 39 37 4B',
      1: '31 37 4B 32 33 34 35 36 37 38 39',
      [-1]: '31 32 33 34 35 36 37 38 37 4B 39',
      [-2]: '31 32 33 34 35 36 37 37 4B 38 39',
    },
  },
  {
    algorithm: 'CRC-16/MODBUS',
    bigEndian: true,
    value: 0x4b37,
    crc: '4B 37',
    packets: {
      0: '31 32 33 34 35 36 37 38 39 4B 37',
      1: '31 4B 37 32 33 34 35 36 37 38 39',
      [-1]: '31 32 33 34 35 36 37 38 4B 37 39',
      [-2]: '31 32 33 34 35 36 37 4B 37 38 39',
    },
  },
  {
    algorithm: 'CRC-32',
    bigEndian: false,
    value: 0xcbf43926,
    crc: '26 39 F4 CB',
    packets: {
      0: '31 32 33 34 35 36 37 38 39 26 39 F4 CB',
      1: '31 26 39 F4 CB 32 33 34 35 36 37 38 39',
      [-1]: '31 32 33 34 35 36 37 38 26 39 F4 CB 39',
      [-2]: '31 32 33 34 35 36 37 26 39 F4 CB 38 39',
    },
  },
  {
    algorithm: 'CRC-32',
    bigEndian: true,
    value: 0xcbf43926,
    crc: 'CB F4 39 26',
    packets: {
      0: '31 32 33 34 35 36 37 38 39 CB F4 39 26',
      1: '31 CB F4 39 26 32 33 34 35 36 37 38 39',
      [-1]: '31 32 33 34 35 36 37 38 CB F4 39 26 39',
      [-2]: '31 32 33 34 35 36 37 CB F4 39 26 38 39',
    },
  },
] as const;

describe('defaults of the Python version', () => {
  it('starts with CRC off, CRC-16/MODBUS big-endian appended, no framing in the CRC', () => {
    expect(DEFAULT_TRANSMIT_CRC).toEqual({
      enabled: false,
      algorithm: 'CRC-16/MODBUS',
      bigEndian: true,
      position: 0,
      useHeader: false,
      header: '',
      useFooter: false,
      footer: '',
      includeHeader: false,
      includeFooter: false,
    });
  });
});

describe('CRC insertion follows Python slicing (0 appends)', () => {
  for (const vector of CHECK_VECTORS) {
    it.each([
      [0, 9],
      [1, 1],
      [-1, 8],
      [-2, 7],
    ] as const)(
      `${vector.algorithm}, ${vector.bigEndian ? 'big' : 'little'} endian, position %i`,
      (position, index) => {
        const input = ascii('123456789');
        const result = insertCrc(input, { ...vector, position });
        expect(result).toEqual({
          data: hex(vector.packets[position]),
          crc: hex(vector.crc),
          value: vector.value,
          index,
        });
        expect(input).toEqual(ascii('123456789'));
      },
    );
  }

  it('appends the Modbus request CRC (little-endian) without replacing any byte', () => {
    expect(insertCrc(hex('01 03 00 00 00 0A'), { ...config(), bigEndian: false }).data).toEqual(
      hex('01 03 00 00 00 0A C5 CD'),
    );
  });

  it('-1 places the CRC at the second-to-last place, 1 makes it the 2nd byte', () => {
    expect(
      insertCrc(hex('01 03 00 00 00 0A'), { ...config(), bigEndian: false, position: -1 }).data,
    ).toEqual(hex('01 03 00 00 00 C5 CD 0A'));
    expect(insertCrc(hex('01 03 00 00 00 0A'), { ...config(), position: 1 }).data).toEqual(
      hex('01 CD C5 03 00 00 00 0A'),
    );
  });

  it('rejects an unknown algorithm instead of inserting a zero checksum', () => {
    expect(() =>
      insertCrc(ascii('123456789'), {
        ...config(),
        algorithm: 'CRC-invalid' as TransmitCrcConfig['algorithm'],
      }),
    ).toThrow(InputError);
  });
});

describe('CRC positions', () => {
  it.each([
    [9, 0, 9],
    [9, 1, 1],
    [9, -1, 8],
    [9, -2, 7],
    [9, -9, 0],
    [9, 9, 9],
    [1, -1, 0],
    [1, 0, 1],
    [0, 0, 0],
  ])('length %i, position %i resolves to index %i', (length, position, expected) => {
    expect(crcInsertionIndex(length, position)).toBe(expected);
  });

  it.each([10, -10, 1.5, -1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects impossible position %s instead of clamping or rounding',
    (position) => {
      expect(() => crcInsertionIndex(9, position)).toThrow(InputError);
      expect(() => insertCrc(ascii('123456789'), { ...config(), position })).toThrow(InputError);
    },
  );

  it('names position and data length in the error', () => {
    expect(() => monitorSendBytes('41', 'HEX', 'CRLF', config({ position: -2 }))).toThrow(/-2.*1/);
  });
});

describe('header and footer like the Python Monitor', () => {
  const framed = (patch: Partial<TransmitCrcConfig>): TransmitCrcConfig =>
    config({
      algorithm: 'CRC-32',
      bigEndian: false,
      useHeader: true,
      header: 'aa55',
      useFooter: true,
      footer: '0d 0a',
      ...patch,
    });

  // zlib.crc32 over the covered bytes, little-endian on the wire.
  it.each([
    {
      includeHeader: true,
      includeFooter: true,
      covered: 'AA 55 31 32 33 34 35 36 37 38 39 0D 0A',
      crc: 'C2 97 19 61',
    },
    {
      includeHeader: false,
      includeFooter: true,
      covered: '31 32 33 34 35 36 37 38 39 0D 0A',
      crc: '74 45 79 88',
    },
    {
      includeHeader: true,
      includeFooter: false,
      covered: 'AA 55 31 32 33 34 35 36 37 38 39',
      crc: 'A4 33 95 0A',
    },
    {
      includeHeader: false,
      includeFooter: false,
      covered: '31 32 33 34 35 36 37 38 39',
      crc: '26 39 F4 CB',
    },
  ])('header in CRC: $includeHeader, footer in CRC: $includeFooter', (vector) => {
    const packet = monitorPacket(
      '31 32 33 34 35 36 37 38 39',
      'HEX',
      'None',
      framed({ includeHeader: vector.includeHeader, includeFooter: vector.includeFooter }),
    )!;
    expect(packet.covered).toEqual(hex(vector.covered));
    expect(packetBytes(packet)).toEqual(
      hex(`AA 55 31 32 33 34 35 36 37 38 39 ${vector.crc} 0D 0A`),
    );
  });

  it('counts the position inside the data, between header and footer', () => {
    const options = framed({ algorithm: 'CRC-16/MODBUS', footer: '0D', position: -1 });
    // Python: header + data[:-1] + crc + data[-1:] + footer
    expect(monitorSendBytes('123456789', 'ASCII', 'None', options)).toEqual(
      hex('61 61 35 35 31 32 33 34 35 36 37 38 37 4B 39 30 44'),
    );
    expect(monitorSendBytes('31 32 33 34 35 36 37 38 39', 'HEX', 'None', options)).toEqual(
      hex('AA 55 31 32 33 34 35 36 37 38 37 4B 39 0D'),
    );
  });

  it('header and footer are written in the Monitor send format', () => {
    const options = config({
      enabled: false,
      useHeader: true,
      header: '2',
      useFooter: true,
      footer: '3',
    });
    expect(monitorSendBytes('65', 'DEC', 'None', options)).toEqual(hex('02 41 03'));
    expect(monitorSendBytes('A', 'ASCII', 'None', options)).toEqual(hex('32 41 33'));
  });

  it('adds header and footer without CRC when only they are switched on', () => {
    const options = config({
      enabled: false,
      useHeader: true,
      header: '02',
      useFooter: true,
      footer: '03',
    });
    expect(monitorSendBytes('41 42', 'HEX', 'CRLF', options)).toEqual(hex('02 41 42 03 0D 0A'));
  });

  it('ignores header and footer texts while they are switched off', () => {
    const options = config({
      header: 'GG',
      footer: 'ZZ',
      includeHeader: true,
      includeFooter: true,
    });
    expect(monitorSendBytes('123456789', 'ASCII', 'None', options)).toEqual(
      hex('31 32 33 34 35 36 37 38 39 4B 37'),
    );
  });

  it('reports malformed header or footer bytes with their name', () => {
    expect(() =>
      monitorSendBytes('01', 'HEX', 'None', config({ useHeader: true, header: 'GG' })),
    ).toThrow(/Header/);
    expect(() => framingBytes(config({ useFooter: true, footer: '100' }), 'HEX')).toThrow(/Footer/);
  });

  it('uses an empty CRC coverage when only excluded framing surrounds an empty body', () => {
    const packet = buildTransmitPacket(
      new Uint8Array(),
      hex('AA 55'),
      hex('0D 0A'),
      config({ bigEndian: false }),
    );
    expect(packetBytes(packet)).toEqual(hex('AA 55 FF FF 0D 0A'));
  });
});

describe('Monitor wire bytes', () => {
  it.each([
    ['None', '31 32 33 34 35 36 37 38 4B 37 39'],
    ['LF', '31 32 33 34 35 36 37 38 4B 37 39 0A'],
    ['CR', '31 32 33 34 35 36 37 38 4B 37 39 0D'],
    ['CRLF', '31 32 33 34 35 36 37 38 4B 37 39 0D 0A'],
  ] as const)('adds %s last, outside CRC coverage and position counting', (newline, expected) => {
    expect(monitorSendBytes('123456789', 'ASCII', newline, config({ position: -1 }))).toEqual(
      hex(expected),
    );
  });

  it.each([
    ['ASCII', '123456789'],
    ['HEX', '31 32 33 34 35 36 37 38 39'],
    ['DEC', '49 50 51 52 53 54 55 56 57'],
    ['BIN', '00110001 00110010 00110011 00110100 00110101 00110110 00110111 00111000 00111001'],
  ] satisfies [DataFormat, string][])(
    'parses %s before computing the CRC over bytes',
    (format, input) => {
      expect(monitorSendBytes(input, format, 'None', config())).toEqual(
        hex('31 32 33 34 35 36 37 38 39 4B 37'),
      );
    },
  );

  it('counts encoded UTF-8 bytes rather than characters', () => {
    // "é" is two bytes (C3 A9); position 1 splits them, exactly as Python slicing would.
    expect(monitorSendBytes('é123456789', 'ASCII', 'None', config({ position: 1 }))).toEqual(
      hex('C3 B5 1E A9 31 32 33 34 35 36 37 38 39'),
    );
  });

  it.each(['ASCII', 'HEX', 'DEC', 'BIN'] as const)(
    'empty %s input sends nothing, even with invalid CRC or framing settings',
    (format) => {
      for (const enabled of [true, false]) {
        for (const input of ['', ' \t\r\n ']) {
          const options = config({ enabled, useHeader: true, header: 'GG', position: -10 });
          expect(monitorSendBytes(input, format, 'CRLF', options)).toEqual(new Uint8Array());
          expect(monitorPacket(input, format, 'CRLF', options)).toBeNull();
        }
      }
    },
  );

  it('keeps the bytes unchanged when CRC, header and footer are off', () => {
    const off = config({ enabled: false, header: 'GG', footer: 'FF', position: -100 });
    expect(monitorSendBytes('00 FF 0D 0A', 'HEX', 'None', off)).toEqual(hex('00 FF 0D 0A'));
    expect(monitorSendBytes('00 FF 0D 0A', 'HEX', 'CRLF', off)).toEqual(hex('00 FF 0D 0A 0D 0A'));
  });

  it('still rejects malformed send data when everything is off', () => {
    expect(() => monitorSendBytes('999', 'DEC', 'None', config({ enabled: false }))).toThrow(
      InputError,
    );
  });

  it('describes the packet parts for the preview', () => {
    const packet = monitorPacket(
      '01 03 00 00 00 0A',
      'HEX',
      'LF',
      config({
        bigEndian: false,
        position: -1,
        useHeader: true,
        header: 'AA',
        useFooter: true,
        footer: '55',
      }),
    )!;
    expect(packet.header).toEqual(hex('AA'));
    expect(packet.body).toEqual(hex('01 03 00 00 00 C5 CD 0A'));
    expect(packet.crc).toEqual(hex('C5 CD'));
    expect(packet.index).toBe(5);
    expect(packet.footer).toEqual(hex('55'));
    expect(packet.newline).toEqual(hex('0A'));
  });
});
