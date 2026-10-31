// One packet builder shared by the calculator preview and Monitor transmission.
import { t } from '../i18n';
import { concatBytes, writeUInt } from './bytes';
import { NEWLINE_BYTES, type Newline } from './commands';
import { calculateCrc, CRC_NAMES, crcSize, type CrcName } from './crc';
import { InputError, parseSendData, type DataFormat } from './format';

export interface TransmitCrcConfig {
  enabled: boolean;
  algorithm: CrcName;
  bigEndian: boolean;
  /** 0 appends; 1 is before the second byte; -1 is before the penultimate byte. */
  position: number;
  /** Framing bytes already present in the input, never implicitly prepended/appended. */
  header: string;
  footer: string;
  includeHeader: boolean;
  includeFooter: boolean;
}

export const DEFAULT_TRANSMIT_CRC: Readonly<TransmitCrcConfig> = Object.freeze({
  enabled: false,
  algorithm: 'CRC-16/MODBUS',
  bigEndian: false,
  position: 0,
  header: '',
  footer: '',
  includeHeader: true,
  includeFooter: true,
});

export function crcInsertionIndex(length: number, position: number): number {
  const index = position === 0 ? length : position > 0 ? position : length + position - 1;
  if (!Number.isSafeInteger(position) || index < 0 || index > length)
    throw new InputError(t('crc.positionError', { position, length }));
  return index;
}

/** Selects CRC coverage without changing the packet or its framing bytes. */
export function crcCoveredBytes(data: Uint8Array, config: TransmitCrcConfig): Uint8Array {
  const header = parseSendData(config.header, 'HEX');
  const footer = parseSendData(config.footer, 'HEX');
  if (
    header.length + footer.length > data.length ||
    header.some((byte, i) => data[i] !== byte) ||
    footer.some((byte, i) => data[data.length - footer.length + i] !== byte)
  )
    throw new InputError(t('crc.framingError'));
  return data.slice(
    config.includeHeader ? 0 : header.length,
    config.includeFooter ? data.length : data.length - footer.length,
  );
}

/** Inserts new bytes (does not overwrite a placeholder or include the new CRC in itself). */
export function insertTransmitCrc(
  data: Uint8Array,
  config: TransmitCrcConfig,
): {
  packet: Uint8Array;
  covered: Uint8Array;
  crc: Uint8Array;
  value: number;
  index: number;
} {
  if (!CRC_NAMES.includes(config.algorithm)) throw new InputError(t('crc.algorithmError'));
  const index = crcInsertionIndex(data.length, config.position);
  const covered = crcCoveredBytes(data, config);
  const value = calculateCrc(covered, config.algorithm);
  const crc = writeUInt(value, crcSize(config.algorithm), config.bigEndian);
  return {
    packet: concatBytes(data.slice(0, index), crc, data.slice(index)),
    covered,
    crc,
    value,
    index,
  };
}

/** Only the Monitor's input uses automatic CRC. A selected line ending is added last. */
export function monitorSendBytes(
  text: string,
  format: DataFormat,
  newline: Newline,
  config: TransmitCrcConfig,
): Uint8Array {
  const data = parseSendData(text, format);
  if (!data.length) return data;
  const packet = config.enabled ? insertTransmitCrc(data, config).packet : data;
  return concatBytes(packet, NEWLINE_BYTES[newline]);
}
