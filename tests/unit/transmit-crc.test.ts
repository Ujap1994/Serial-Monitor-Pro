import { describe, expect, it } from 'vitest';
import { InputError, type DataFormat } from '@shared/core/format';
import {
  crcCoveredBytes,
  crcInsertionIndex,
  DEFAULT_TRANSMIT_CRC,
  insertTransmitCrc,
  monitorSendBytes,
  type TransmitCrcConfig,
} from '@shared/core/transmit-crc';
import { ascii, hex } from './helpers';

const config = (patch: Partial<TransmitCrcConfig> = {}): TransmitCrcConfig => ({
  ...DEFAULT_TRANSMIT_CRC,
  enabled: true,
  ...patch,
});

// Fixed check values for ASCII "123456789"; never derive expected bytes from the CRC engine.
const CHECK_VECTORS = [
  {
    algorithm: 'CRC-8',
    bigEndian: false,
    value: 0xf4,
    crc: 'F4',
    packets: [
      '31 32 33 34 35 36 37 38 39 F4',
      '31 F4 32 33 34 35 36 37 38 39',
      '31 32 33 34 35 36 37 F4 38 39',
    ],
  },
  {
    algorithm: 'CRC-8',
    bigEndian: true,
    value: 0xf4,
    crc: 'F4',
    packets: [
      '31 32 33 34 35 36 37 38 39 F4',
      '31 F4 32 33 34 35 36 37 38 39',
      '31 32 33 34 35 36 37 F4 38 39',
    ],
  },
  {
    algorithm: 'CRC-16/MODBUS',
    bigEndian: false,
    value: 0x4b37,
    crc: '37 4B',
    packets: [
      '31 32 33 34 35 36 37 38 39 37 4B',
      '31 37 4B 32 33 34 35 36 37 38 39',
      '31 32 33 34 35 36 37 37 4B 38 39',
    ],
  },
  {
    algorithm: 'CRC-16/MODBUS',
    bigEndian: true,
    value: 0x4b37,
    crc: '4B 37',
    packets: [
      '31 32 33 34 35 36 37 38 39 4B 37',
      '31 4B 37 32 33 34 35 36 37 38 39',
      '31 32 33 34 35 36 37 4B 37 38 39',
    ],
  },
  {
    algorithm: 'CRC-32',
    bigEndian: false,
    value: 0xcbf43926,
    crc: '26 39 F4 CB',
    packets: [
      '31 32 33 34 35 36 37 38 39 26 39 F4 CB',
      '31 26 39 F4 CB 32 33 34 35 36 37 38 39',
      '31 32 33 34 35 36 37 26 39 F4 CB 38 39',
    ],
  },
  {
    algorithm: 'CRC-32',
    bigEndian: true,
    value: 0xcbf43926,
    crc: 'CB F4 39 26',
    packets: [
      '31 32 33 34 35 36 37 38 39 CB F4 39 26',
      '31 CB F4 39 26 32 33 34 35 36 37 38 39',
      '31 32 33 34 35 36 37 CB F4 39 26 38 39',
    ],
  },
] as const;

describe('CRC packet insertion', () => {
  for (const vector of CHECK_VECTORS) {
    it.each([
      [0, 9, vector.packets[0]],
      [1, 1, vector.packets[1]],
      [-1, 7, vector.packets[2]],
    ])(
      `${vector.algorithm}, ${vector.bigEndian ? 'big' : 'little'} endian, position %i`,
      (position, index, packet) => {
        const input = ascii('123456789');
        const result = insertTransmitCrc(input, config({ ...vector, position }));
        expect(result).toEqual({
          packet: hex(packet),
          covered: ascii('123456789'),
          crc: hex(vector.crc),
          value: vector.value,
          index,
        });
        expect(input).toEqual(ascii('123456789'));
      },
    );
  }

  it('appends the Modbus request CRC without replacing data or a placeholder', () => {
    expect(insertTransmitCrc(hex('01 03 00 00 00 0A'), config()).packet).toEqual(
      hex('01 03 00 00 00 0A C5 CD'),
    );
  });

  it('calculates a preview even when automatic Monitor insertion is off', () => {
    expect(insertTransmitCrc(ascii('123456789'), config({ enabled: false })).packet).toEqual(
      hex('31 32 33 34 35 36 37 38 39 37 4B'),
    );
  });

  it('rejects an unknown algorithm instead of inserting a zero checksum', () => {
    expect(() =>
      insertTransmitCrc(ascii('123456789'), {
        ...config(),
        algorithm: 'CRC-invalid' as TransmitCrcConfig['algorithm'],
      }),
    ).toThrow(InputError);
  });
});

describe('CRC positions refer only to original packet bytes', () => {
  it.each([
    [9, 0, 9],
    [9, 1, 1],
    [9, -1, 7],
    [9, -8, 0],
    [9, 9, 9],
    [2, -1, 0],
    [1, 0, 1],
    [0, 0, 0],
  ])('length %i, position %i resolves to %i', (length, position, expected) => {
    expect(crcInsertionIndex(length, position)).toBe(expected);
  });

  it.each([10, -9, 1.5, -1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid position %s without clamping or rounding',
    (position) => {
      expect(() => crcInsertionIndex(9, position)).toThrow(InputError);
      expect(() => insertTransmitCrc(ascii('123456789'), config({ position }))).toThrow(InputError);
    },
  );

  it('rejects a penultimate-byte position when the input has only one byte', () => {
    expect(() => monitorSendBytes('41', 'HEX', 'CRLF', config({ position: -1 }))).toThrow(
      InputError,
    );
  });
});

describe('existing HEX header and footer control coverage independently', () => {
  const original = 'AA 55 31 32 33 34 35 36 37 38 39 0D 0A';
  // Independently cross-checked with Python zlib.crc32, including the leading zero in 0A9533A4.
  it.each([
    {
      includeHeader: true,
      includeFooter: true,
      covered: original,
      value: 0x611997c2,
      crc: 'C2 97 19 61',
      packet: 'AA 55 31 32 33 34 35 36 37 38 39 C2 97 19 61 0D 0A',
    },
    {
      includeHeader: false,
      includeFooter: true,
      covered: '31 32 33 34 35 36 37 38 39 0D 0A',
      value: 0x88794574,
      crc: '74 45 79 88',
      packet: 'AA 55 31 32 33 34 35 36 37 38 39 74 45 79 88 0D 0A',
    },
    {
      includeHeader: true,
      includeFooter: false,
      covered: 'AA 55 31 32 33 34 35 36 37 38 39',
      value: 0x0a9533a4,
      crc: 'A4 33 95 0A',
      packet: 'AA 55 31 32 33 34 35 36 37 38 39 A4 33 95 0A 0D 0A',
    },
    {
      includeHeader: false,
      includeFooter: false,
      covered: '31 32 33 34 35 36 37 38 39',
      value: 0xcbf43926,
      crc: '26 39 F4 CB',
      packet: 'AA 55 31 32 33 34 35 36 37 38 39 26 39 F4 CB 0D 0A',
    },
  ])('header $includeHeader, footer $includeFooter', (vector) => {
    const options = config({
      algorithm: 'CRC-32',
      position: -1,
      header: 'aa55',
      footer: '0d 0a',
      includeHeader: vector.includeHeader,
      includeFooter: vector.includeFooter,
    });
    const input = hex(original);
    expect(crcCoveredBytes(input, options)).toEqual(hex(vector.covered));
    expect(insertTransmitCrc(input, options)).toEqual({
      packet: hex(vector.packet),
      covered: hex(vector.covered),
      crc: hex(vector.crc),
      value: vector.value,
      index: 11,
    });
    expect(input).toEqual(hex(original));
  });

  it('permits touching non-overlapping framing with empty coverage', () => {
    expect(
      insertTransmitCrc(
        hex('AA 55 0D 0A'),
        config({
          header: 'AA 55',
          footer: '0D 0A',
          includeHeader: false,
          includeFooter: false,
          position: -1,
        }),
      ).packet,
    ).toEqual(hex('AA 55 FF FF 0D 0A'));
  });

  it('does not remove repeated header or footer bytes inside the payload', () => {
    expect(
      crcCoveredBytes(
        hex('AA 55 AA 55 0D 0A 0D 0A'),
        config({ header: 'AA 55', footer: '0D 0A', includeHeader: false, includeFooter: false }),
      ),
    ).toEqual(hex('AA 55 0D 0A'));
  });

  it.each([
    { name: 'header mismatch', data: original, header: 'AB 55', footer: '0D 0A' },
    { name: 'footer mismatch', data: original, header: 'AA 55', footer: '0D 0B' },
    { name: 'absent framing', data: '31 32 33', header: 'AA 55', footer: '0D 0A' },
    { name: 'overlap despite matching ends', data: 'AA AA AA', header: 'AA AA', footer: 'AA AA' },
    { name: 'malformed header HEX', data: original, header: 'GG', footer: '' },
    { name: 'malformed footer HEX', data: original, header: '', footer: 'GG' },
    { name: 'header byte overflow', data: original, header: '100', footer: '' },
    { name: 'footer byte overflow', data: original, header: '', footer: '100' },
  ])('rejects $name whether framing is included or excluded', ({ data, header, footer }) => {
    for (const included of [true, false]) {
      const options = config({ header, footer, includeHeader: included, includeFooter: included });
      expect(() => crcCoveredBytes(hex(data), options)).toThrow(InputError);
      expect(() => insertTransmitCrc(hex(data), options)).toThrow(InputError);
      expect(() => monitorSendBytes(data, 'HEX', 'None', options)).toThrow(InputError);
    }
  });
});

describe('manual Monitor wire bytes', () => {
  it.each([
    ['None', '31 32 33 34 35 36 37 37 4B 38 39'],
    ['LF', '31 32 33 34 35 36 37 37 4B 38 39 0A'],
    ['CR', '31 32 33 34 35 36 37 37 4B 38 39 0D'],
    ['CRLF', '31 32 33 34 35 36 37 37 4B 38 39 0D 0A'],
  ] as const)(
    'adds %s after CRC insertion, outside coverage and position counting',
    (newline, expected) => {
      expect(monitorSendBytes('123456789', 'ASCII', newline, config({ position: -1 }))).toEqual(
        hex(expected),
      );
    },
  );

  it('does not treat the selected line ending as an existing footer', () => {
    expect(() =>
      monitorSendBytes('123456789', 'ASCII', 'CRLF', config({ footer: '0D 0A' })),
    ).toThrow(InputError);
  });

  it.each([
    ['ASCII', '123456789'],
    ['HEX', '31 32 33 34 35 36 37 38 39'],
    ['DEC', '49 50 51 52 53 54 55 56 57'],
    ['BIN', '00110001 00110010 00110011 00110100 00110101 00110110 00110111 00111000 00111001'],
  ] satisfies [DataFormat, string][])(
    'parses %s before computing CRC over bytes',
    (format, input) => {
      expect(monitorSendBytes(input, format, 'None', config())).toEqual(
        hex('31 32 33 34 35 36 37 38 39 37 4B'),
      );
    },
  );

  it('counts encoded UTF-8 bytes rather than source characters', () => {
    expect(
      monitorSendBytes(
        'é123456789!',
        'ASCII',
        'None',
        config({
          header: 'C3 A9',
          footer: '21',
          includeHeader: false,
          includeFooter: false,
          position: 1,
        }),
      ),
    ).toEqual(hex('C3 37 4B A9 31 32 33 34 35 36 37 38 39 21'));
  });

  it.each(['ASCII', 'HEX', 'DEC', 'BIN'] as const)(
    'empty %s input sends neither CRC nor newline, even with invalid CRC settings',
    (format) => {
      for (const enabled of [true, false]) {
        for (const input of ['', ' \t\r\n ']) {
          expect(
            monitorSendBytes(
              input,
              format,
              'CRLF',
              config({ enabled, header: 'GG', position: -10 }),
            ),
          ).toEqual(new Uint8Array());
        }
      }
    },
  );

  it('preserves original bytes when automatic CRC is disabled, ignoring inactive CRC errors', () => {
    const disabled = config({ enabled: false, header: 'GG', footer: 'FF', position: -100 });
    expect(monitorSendBytes('00 FF 0D 0A', 'HEX', 'None', disabled)).toEqual(hex('00 FF 0D 0A'));
    expect(monitorSendBytes('00 FF 0D 0A', 'HEX', 'CRLF', disabled)).toEqual(
      hex('00 FF 0D 0A 0D 0A'),
    );
  });

  it('still rejects malformed send data when automatic CRC is disabled', () => {
    expect(() => monitorSendBytes('999', 'DEC', 'None', config({ enabled: false }))).toThrow(
      InputError,
    );
  });
});
