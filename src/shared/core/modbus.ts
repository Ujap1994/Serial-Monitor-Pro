// Modbus RTU decoder.

import { t } from '../i18n';
import { readUInt, toHexString } from './bytes';
import { calculateCrc } from './crc';

const FUNCTIONS: Record<number, string> = {
  1: 'Read Coils',
  2: 'Read Discrete Inputs',
  3: 'Read Holding Registers',
  4: 'Read Input Registers',
  5: 'Write Single Coil',
  6: 'Write Single Register',
  15: 'Write Multiple Coils',
  16: 'Write Multiple Registers',
  23: 'Read/Write Multiple Registers',
};

const EXCEPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 11] as const;
type ExceptionCode = (typeof EXCEPTIONS)[number];

function functionName(code: number): string {
  return FUNCTIONS[code] ?? t('modbus.unknown');
}

function exceptionName(code: number): string {
  return (EXCEPTIONS as readonly number[]).includes(code)
    ? t(`modbus.exception.${code as ExceptionCode}`)
    : t('modbus.unknown');
}

/** Decodes a Modbus RTU telegram into readable text. */
export function decodeModbusRtu(frame: Uint8Array): string {
  if (frame.length < 4) return t('modbus.tooShort');
  const slave = frame[0] ?? 0;
  const func = frame[1] ?? 0;
  const body = frame.subarray(0, -2);
  const crcFound = readUInt(frame.subarray(-2), false);
  const crcCalc = calculateCrc(body, 'CRC-16/MODBUS');
  const crcText =
    crcFound === crcCalc
      ? 'CRC ✓'
      : t('modbus.crcMismatch', {
          found: crcFound.toString(16).toUpperCase().padStart(4, '0'),
          expected: crcCalc.toString(16).toUpperCase().padStart(4, '0'),
        });

  const parts = [`${t('modbus.slave')} ${slave}`];
  if (func & 0x80) {
    const base = func & 0x7f;
    const code = frame[2] ?? 0;
    parts.push(t('modbus.errorOn', { func: base, name: functionName(base) }));
    parts.push(t('modbus.exception', { code, name: exceptionName(code) }));
    return [...parts, crcText].join('  |  ');
  }

  parts.push(`${t('modbus.function')} ${func} (${functionName(func)})`);
  const data = frame.subarray(2, -2);
  if ([1, 2, 3, 4].includes(func) && data.length) {
    // Request and response look alike, but they can be told apart by the
    // first byte: in a response it is the number of following data bytes
    // and matches the rest exactly. A request always carries four bytes
    // (start address + quantity).
    const n = data[0] ?? 0;
    if (data.length === n + 1) {
      const values = data.subarray(1, 1 + n);
      if ((func === 3 || func === 4) && n >= 2) {
        const regs: number[] = [];
        for (let i = 0; i + 1 < values.length; i += 2) {
          regs.push(readUInt(values.subarray(i, i + 2), true));
        }
        parts.push(
          t('modbus.responseRegisters', { count: regs.length, values: `[${regs.join(', ')}]` }),
        );
      } else {
        parts.push(t('modbus.responseBytes', { count: n, values: toHexString(values) }));
      }
    } else if (data.length >= 4) {
      parts.push(
        t('modbus.request', {
          address: readUInt(data.subarray(0, 2), true),
          count: readUInt(data.subarray(2, 4), true),
        }),
      );
    } else {
      parts.push(`${t('modbus.data')}: ${toHexString(data)}`);
    }
  } else if ((func === 5 || func === 6) && data.length >= 4) {
    const address = readUInt(data.subarray(0, 2), true);
    const value = readUInt(data.subarray(2, 4), true);
    parts.push(
      func === 5
        ? t('modbus.coil', { address, state: value === 0xff00 ? t('modbus.on') : t('modbus.off') })
        : t('modbus.register', { address, value }),
    );
  } else if ((func === 15 || func === 16) && data.length >= 4) {
    const address = readUInt(data.subarray(0, 2), true);
    const count = readUInt(data.subarray(2, 4), true);
    if (data.length === 4) {
      parts.push(t('modbus.written', { address, count }));
    } else {
      parts.push(
        t('modbus.writeRequest', { address, count, bytes: toHexString(data.subarray(5)) }),
      );
    }
  } else if (data.length) {
    parts.push(`${t('modbus.data')}: ${toHexString(data)}`);
  }
  return [...parts, crcText].join('  |  ');
}

/** Builds a request frame (with CRC) – used by the simulator and the tests. */
export function buildModbusFrame(body: Uint8Array): Uint8Array {
  const crc = calculateCrc(body, 'CRC-16/MODBUS');
  const out = new Uint8Array(body.length + 2);
  out.set(body);
  out[body.length] = crc & 0xff;
  out[body.length + 1] = (crc >>> 8) & 0xff;
  return out;
}
