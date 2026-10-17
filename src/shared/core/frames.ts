// Recognition of user-defined telegrams in a byte stream.
//
//   [header] [length] [payload] [checksum] [footer]
//
// Every part except the payload is optional.

import { t } from '../i18n';
import { indexOfBytes, readUInt, toHexString } from './bytes';
import { calculateCrc, crcSize, formatCrc } from './crc';

export type LengthCounts = 'payload' | 'payload_crc' | 'frame';

export interface FrameSpec {
  header: Uint8Array;
  footer: Uint8Array;
  /** Position of the length field after the header, -1 = no length field. */
  lengthOffset: number;
  /** 1 or 2 bytes. */
  lengthSize: number;
  lengthBigEndian: boolean;
  lengthCounts: LengthCounts;
  /** Empty = no checksum. */
  crcAlgo: string;
  crcBigEndian: boolean;
  /** Fixed total length if there is neither a length field nor a footer (0 = unknown). */
  fixedLength: number;
}

export function frameSpec(partial: Partial<FrameSpec> = {}): FrameSpec {
  return {
    header: new Uint8Array(),
    footer: new Uint8Array(),
    lengthOffset: -1,
    lengthSize: 1,
    lengthBigEndian: true,
    lengthCounts: 'payload',
    crcAlgo: '',
    crcBigEndian: true,
    fixedLength: 0,
    ...partial,
  };
}

export interface ParsedFrame {
  raw: Uint8Array;
  payload: Uint8Array;
  /** null = no checksum configured. */
  crcOk: boolean | null;
  crcExpected: number | null;
  crcFound: number | null;
  note: string;
}

/**
 * Searches complete telegrams in the buffer.
 *
 * Returns the frames and the unprocessed remainder. The remainder is returned
 * rather than discarded: on a serial line a telegram often arrives in several
 * pieces – the caller prepends it to the next data.
 */
export function findFrames(
  buffer: Uint8Array,
  spec: FrameSpec,
): { frames: ParsedFrame[]; rest: Uint8Array } {
  const frames: ParsedFrame[] = [];
  const data = buffer;
  const checksumSize = crcSize(spec.crcAlgo);
  let pos = 0;

  while (pos < data.length) {
    // 1. Find the header
    let start: number;
    let bodyStart: number;
    if (spec.header.length) {
      start = indexOfBytes(data, spec.header, pos);
      if (start < 0) {
        // No header left: keep only a possible partial header at the end –
        // but never bytes of a telegram that has already been returned.
        const keep = Math.max(pos, data.length - (spec.header.length - 1));
        return { frames, rest: data.slice(keep) };
      }
      bodyStart = start + spec.header.length;
    } else {
      start = pos;
      bodyStart = pos;
    }

    // 2. Determine the total length
    let total: number;
    let payloadLen: number;

    if (spec.lengthOffset >= 0) {
      const lpos = bodyStart + spec.lengthOffset;
      if (lpos + spec.lengthSize > data.length) {
        return { frames, rest: data.slice(start) }; // length field incomplete
      }
      const value = readUInt(data.subarray(lpos, lpos + spec.lengthSize), spec.lengthBigEndian);
      const afterLen = lpos + spec.lengthSize;
      if (spec.lengthCounts === 'payload') {
        payloadLen = value;
        total = afterLen - start + value + checksumSize + spec.footer.length;
      } else if (spec.lengthCounts === 'payload_crc') {
        payloadLen = Math.max(0, value - checksumSize);
        total = afterLen - start + value + spec.footer.length;
      } else {
        total = value;
        payloadLen = Math.max(0, value - (afterLen - start) - checksumSize - spec.footer.length);
      }
    } else if (spec.fixedLength > 0) {
      total = spec.fixedLength;
      payloadLen = Math.max(0, total - spec.header.length - checksumSize - spec.footer.length);
    } else if (spec.footer.length) {
      const end = indexOfBytes(data, spec.footer, bodyStart);
      if (end < 0) return { frames, rest: data.slice(start) }; // footer still missing
      total = end + spec.footer.length - start;
      payloadLen = Math.max(0, total - spec.header.length - checksumSize - spec.footer.length);
    } else {
      // Neither length, fixed size nor footer – cannot be evaluated.
      return { frames, rest: data.slice(start) };
    }

    if (total <= 0) {
      pos = start + 1; // unusable, keep searching
      continue;
    }
    if (start + total > data.length) {
      return { frames, rest: data.slice(start) }; // telegram still incomplete
    }

    const raw = data.slice(start, start + total);

    // 3. Extract payload and checksum
    const payStart =
      spec.lengthOffset >= 0 ? bodyStart + spec.lengthOffset + spec.lengthSize : bodyStart;
    const payEnd = payStart + payloadLen;
    const frame: ParsedFrame = {
      raw,
      payload: raw.slice(payStart - start, payEnd - start),
      crcOk: null,
      crcExpected: null,
      crcFound: null,
      note: '',
    };

    if (checksumSize) {
      const crcStart = payEnd - start;
      const crcBytes = raw.subarray(crcStart, crcStart + checksumSize);
      if (crcBytes.length === checksumSize) {
        const found = readUInt(crcBytes, spec.crcBigEndian);
        // Usual coverage: everything from the header up to the checksum.
        const expected = calculateCrc(raw.subarray(0, crcStart), spec.crcAlgo);
        frame.crcFound = found;
        frame.crcExpected = expected;
        frame.crcOk = found === expected;
      } else {
        frame.note = t('frame.crcIncomplete');
      }
    }

    frames.push(frame);
    pos = start + total;
  }

  return { frames, rest: new Uint8Array() };
}

/** One-line description of a recognised telegram. */
export function describeFrame(frame: ParsedFrame, spec: FrameSpec): string {
  const parts = [`${String(frame.raw.length).padStart(3)} B`];
  if (spec.header.length) parts.push(`${t('frame.header')} ${toHexString(spec.header)}`);
  parts.push(`${t('frame.data')} ${toHexString(frame.payload) || '—'}`);
  if (frame.crcOk === true && frame.crcFound !== null) {
    parts.push(`CRC ✓ ${formatCrc(frame.crcFound, spec.crcAlgo)}`);
  } else if (frame.crcOk === false && frame.crcFound !== null && frame.crcExpected !== null) {
    parts.push(
      t('frame.crcMismatch', {
        found: formatCrc(frame.crcFound, spec.crcAlgo),
        expected: formatCrc(frame.crcExpected, spec.crcAlgo),
      }),
    );
  }
  if (frame.note) parts.push(frame.note);
  return parts.join('  |  ');
}
