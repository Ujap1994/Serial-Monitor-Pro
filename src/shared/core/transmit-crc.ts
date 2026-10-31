// Transmit framing and checksum, modelled on the former Python (CustomTkinter)
// version of Serial Monitor Pro:
//
//   Monitor input   header + data (CRC inserted at the position) + footer + line ending
//   Preset "add CRC" data (CRC inserted at the position) + line ending
//
// The CRC is calculated over the data, plus header and/or footer when they are
// included, but never over the CRC bytes themselves or the line ending.
import { t } from '../i18n';
import { concatBytes, writeUInt } from './bytes';
import { calculateCrc, crcSize, isCrcName, type CrcName } from './crc';
import { InputError, parseSendData, type DataFormat } from './format';
import { NEWLINE_BYTES, type Newline } from './newline';

export interface TransmitCrcConfig {
  /** "Add CRC" in the Monitor: calculate and insert the CRC into every Monitor send. */
  enabled: boolean;
  algorithm: CrcName;
  bigEndian: boolean;
  /**
   * Position inside the data (between header and footer). 0 appends the CRC,
   * n > 0 inserts it before data byte n + 1 (1 → the CRC becomes the 2nd byte),
   * n < 0 counts from the right like Python slicing (-1 → before the last byte).
   */
  position: number;
  /** Header added in front of every Monitor send, written in the Monitor send format. */
  useHeader: boolean;
  header: string;
  /** Footer added after every Monitor send (before the line ending). */
  useFooter: boolean;
  footer: string;
  /** Whether header/footer bytes are part of the CRC calculation. */
  includeHeader: boolean;
  includeFooter: boolean;
}

/** Defaults of the Python version. */
export const DEFAULT_TRANSMIT_CRC: Readonly<TransmitCrcConfig> = Object.freeze({
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

/** Index inside `length` data bytes at which the CRC is inserted. Throws for impossible positions. */
export function crcInsertionIndex(length: number, position: number): number {
  if (!Number.isSafeInteger(position))
    throw new InputError(t('crc.positionError', { position, length }));
  const index = position === 0 ? length : position > 0 ? position : length + position;
  if (index < 0 || index > length)
    throw new InputError(t('crc.positionError', { position, length }));
  return index;
}

/** CRC value and its bytes in the configured byte order. */
export function crcBytes(
  covered: Uint8Array,
  algorithm: string,
  bigEndian: boolean,
): { value: number; bytes: Uint8Array } {
  if (!isCrcName(algorithm)) throw new InputError(t('crc.algorithmError'));
  const value = calculateCrc(covered, algorithm);
  return { value, bytes: writeUInt(value, crcSize(algorithm), bigEndian) };
}

/** Inserts (never overwrites) the CRC of `covered` into `data`. */
export function insertCrc(
  data: Uint8Array,
  config: Pick<TransmitCrcConfig, 'algorithm' | 'bigEndian' | 'position'>,
  covered: Uint8Array = data,
): { data: Uint8Array; crc: Uint8Array; value: number; index: number } {
  const index = crcInsertionIndex(data.length, config.position);
  const { value, bytes } = crcBytes(covered, config.algorithm, config.bigEndian);
  return {
    data: concatBytes(data.subarray(0, index), bytes, data.subarray(index)),
    crc: bytes,
    value,
    index,
  };
}

/** All parts of one Monitor transmission, for sending and for the preview. */
export interface TransmitPacket {
  header: Uint8Array;
  /** Data with the CRC already inserted (when enabled). */
  body: Uint8Array;
  footer: Uint8Array;
  newline: Uint8Array;
  /** Bytes the CRC was calculated over; null without CRC. */
  covered: Uint8Array | null;
  crc: Uint8Array | null;
  value: number | null;
  /** Insertion index inside the data; -1 without CRC. */
  index: number;
}

/** Header and footer bytes as they are switched on, parsed in the given format. */
export function framingBytes(
  config: TransmitCrcConfig,
  format: DataFormat,
): { header: Uint8Array; footer: Uint8Array } {
  const parse = (text: string, label: string): Uint8Array => {
    try {
      return parseSendData(text, format);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InputError(`${label}: ${message}`);
    }
  };
  return {
    header: config.useHeader ? parse(config.header, t('crc.header')) : new Uint8Array(),
    footer: config.useFooter ? parse(config.footer, t('crc.footer')) : new Uint8Array(),
  };
}

/** Builds header + data (with CRC) + footer + line ending. */
export function buildTransmitPacket(
  data: Uint8Array,
  header: Uint8Array,
  footer: Uint8Array,
  config: TransmitCrcConfig,
  newline: Newline = 'None',
): TransmitPacket {
  const packet: TransmitPacket = {
    header,
    body: data,
    footer,
    newline: NEWLINE_BYTES[newline],
    covered: null,
    crc: null,
    value: null,
    index: -1,
  };
  if (!config.enabled) return packet;
  const covered = concatBytes(
    config.includeHeader ? header : new Uint8Array(),
    data,
    config.includeFooter ? footer : new Uint8Array(),
  );
  const inserted = insertCrc(data, config, covered);
  return { ...packet, body: inserted.data, covered, ...inserted };
}

export function packetBytes(packet: TransmitPacket): Uint8Array {
  return concatBytes(packet.header, packet.body, packet.footer, packet.newline);
}

/** Monitor input → packet. Empty input yields null (nothing is sent). Throws {@link InputError}. */
export function monitorPacket(
  text: string,
  format: DataFormat,
  newline: Newline,
  config: TransmitCrcConfig,
): TransmitPacket | null {
  const data = parseSendData(text, format);
  if (!data.length) return null;
  const { header, footer } = framingBytes(config, format);
  return buildTransmitPacket(data, header, footer, config, newline);
}

/** Bytes the Monitor sends for an input. Empty input yields no bytes. */
export function monitorSendBytes(
  text: string,
  format: DataFormat,
  newline: Newline,
  config: TransmitCrcConfig,
): Uint8Array {
  const packet = monitorPacket(text, format, newline, config);
  return packet ? packetBytes(packet) : new Uint8Array();
}
