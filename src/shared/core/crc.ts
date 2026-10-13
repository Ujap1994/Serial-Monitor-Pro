// CRC engine. All presets are verified against the official check values
// (input "123456789") in tests/unit/crc.test.ts.

export interface CrcPreset {
  poly: number;
  init: number;
  refin: boolean;
  refout: boolean;
  xorout: number;
  width: 8 | 16 | 32;
}

export const CRC_PRESETS = {
  'CRC-8': { poly: 0x07, init: 0x00, refin: false, refout: false, xorout: 0x00, width: 8 },
  'CRC-8/MAXIM': { poly: 0x31, init: 0x00, refin: true, refout: true, xorout: 0x00, width: 8 },
  'CRC-8/SAE-J1850': {
    poly: 0x1d,
    init: 0xff,
    refin: false,
    refout: false,
    xorout: 0xff,
    width: 8,
  },
  'CRC-16/IBM': {
    poly: 0x8005,
    init: 0x0000,
    refin: true,
    refout: true,
    xorout: 0x0000,
    width: 16,
  },
  'CRC-16/MODBUS': {
    poly: 0x8005,
    init: 0xffff,
    refin: true,
    refout: true,
    xorout: 0x0000,
    width: 16,
  },
  'CRC-16/CCITT-False': {
    poly: 0x1021,
    init: 0xffff,
    refin: false,
    refout: false,
    xorout: 0x0000,
    width: 16,
  },
  'CRC-16/XMODEM': {
    poly: 0x1021,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x0000,
    width: 16,
  },
  'CRC-16/USB': {
    poly: 0x8005,
    init: 0xffff,
    refin: true,
    refout: true,
    xorout: 0xffff,
    width: 16,
  },
  'CRC-32': {
    poly: 0x04c11db7,
    init: 0xffffffff,
    refin: true,
    refout: true,
    xorout: 0xffffffff,
    width: 32,
  },
  'CRC-32/BZIP2': {
    poly: 0x04c11db7,
    init: 0xffffffff,
    refin: false,
    refout: false,
    xorout: 0xffffffff,
    width: 32,
  },
  'CRC-32C': {
    poly: 0x1edc6f41,
    init: 0xffffffff,
    refin: true,
    refout: true,
    xorout: 0xffffffff,
    width: 32,
  },
} as const satisfies Record<string, CrcPreset>;

export type CrcName = keyof typeof CRC_PRESETS;
export const CRC_NAMES = Object.keys(CRC_PRESETS) as CrcName[];

export function isCrcName(name: string): name is CrcName {
  return Object.prototype.hasOwnProperty.call(CRC_PRESETS, name);
}

function reflect(value: number, width: number): number {
  let r = 0;
  for (let i = 0; i < width; i++) {
    if ((value >>> i) & 1) r |= 1 << (width - 1 - i);
  }
  return r >>> 0;
}

function maskFor(width: number): number {
  return width === 32 ? 0xffffffff : (1 << width) - 1;
}

/** Width of the checksum in bytes (0 for an unknown name). */
export function crcSize(name: string): number {
  return isCrcName(name) ? CRC_PRESETS[name].width / 8 : 0;
}

/** Calculates the checksum; an unknown preset yields 0. */
export function calculateCrc(data: Uint8Array, name: string): number {
  if (!isCrcName(name)) return 0;
  const p: CrcPreset = CRC_PRESETS[name];
  const mask = maskFor(p.width);
  const top = p.width - 1;
  let crc = p.init >>> 0;
  for (const raw of data) {
    const byte = p.refin ? reflect(raw, 8) : raw;
    crc = (crc ^ (byte << (p.width - 8))) >>> 0;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> top) & 1 ? (((crc << 1) ^ p.poly) & mask) >>> 0 : ((crc << 1) & mask) >>> 0;
    }
  }
  if (p.refout) crc = reflect(crc, p.width);
  return ((crc ^ p.xorout) & mask) >>> 0;
}

/** Hex representation with the number of digits matching the width. */
export function formatCrc(value: number, name: string): string {
  const width = isCrcName(name) ? CRC_PRESETS[name].width : 16;
  return value
    .toString(16)
    .toUpperCase()
    .padStart(width / 4, '0');
}
