import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import { concatBytes } from '@shared/core/bytes';
import { calculateCrc } from '@shared/core/crc';
import { describeFrame, findFrames, frameSpec } from '@shared/core/frames';
import { buildModbusFrame } from '@shared/core/modbus';
import { ascii, bytes } from './helpers';

beforeAll(() => setLanguage('de'));

const modbus = buildModbusFrame(bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x0a));
const specModbus = frameSpec({ fixedLength: 8, crcAlgo: 'CRC-16/MODBUS', crcBigEndian: false });

const specHeader = frameSpec({
  header: bytes(0xaa, 0x55),
  lengthOffset: 0,
  lengthSize: 1,
  lengthCounts: 'payload',
  crcAlgo: 'CRC-8',
});
const payload = bytes(0x11, 0x22, 0x33);
const covered = bytes(0xaa, 0x55, 3, ...payload);
const telegram = bytes(...covered, calculateCrc(covered, 'CRC-8'));

describe('findFrames', () => {
  it('recognises a Modbus RTU telegram with fixed length', () => {
    const { frames, rest } = findFrames(modbus, specModbus);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.crcOk).toBe(true);
    expect(rest).toHaveLength(0);
  });

  it('recognises header + length field + CRC', () => {
    const { frames } = findFrames(telegram, specHeader);
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0]?.payload ?? [])).toEqual(Array.from(payload));
    expect(frames[0]?.crcOk).toBe(true);
  });

  it('skips garbage in front of telegrams', () => {
    const { frames } = findFrames(bytes(0x99, 0x99, ...telegram, ...telegram), specHeader);
    expect(frames).toHaveLength(2);
  });

  it('reports a wrong checksum', () => {
    const bad = telegram.slice();
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 0xff;
    const { frames } = findFrames(bad, specHeader);
    expect(frames[0]?.crcOk).toBe(false);
  });

  it('assembles telegrams that arrive in 2-byte pieces', () => {
    const stream = bytes(...telegram, ...telegram, ...telegram);
    let buffer: Uint8Array = new Uint8Array();
    let found = 0;
    for (let i = 0; i < stream.length; i += 2) {
      const { frames, rest } = findFrames(
        concatBytes(buffer, stream.subarray(i, i + 2)),
        specHeader,
      );
      found += frames.length;
      buffer = rest;
    }
    expect(found).toBe(3);
  });

  it('uses a footer instead of a length field', () => {
    const spec = frameSpec({ header: bytes(0x02), footer: bytes(0x03) });
    const { frames } = findFrames(
      bytes(0x02, ...ascii('HALLO'), 0x03, 0x02, ...ascii('WELT'), 0x03),
      spec,
    );
    expect(frames).toHaveLength(2);
    expect(new TextDecoder().decode(frames[0]?.payload)).toBe('HALLO');
  });

  it('supports length fields that count payload + CRC or the whole frame', () => {
    // payload (3) + crc (1) = 4
    const a = bytes(0xaa, 4, 0x10, 0x20, 0x30);
    const frameA = bytes(...a, calculateCrc(a, 'CRC-8'));
    const specA = frameSpec({
      header: bytes(0xaa),
      lengthOffset: 0,
      lengthCounts: 'payload_crc',
      crcAlgo: 'CRC-8',
    });
    expect(findFrames(frameA, specA).frames[0]?.crcOk).toBe(true);
    expect(findFrames(frameA, specA).frames[0]?.payload).toHaveLength(3);
    // whole frame = 6 bytes
    const b = bytes(0xaa, 6, 0x10, 0x20, 0x30);
    const frameB = bytes(...b, calculateCrc(b, 'CRC-8'));
    const specB = frameSpec({
      header: bytes(0xaa),
      lengthOffset: 0,
      lengthCounts: 'frame',
      crcAlgo: 'CRC-8',
    });
    expect(findFrames(frameB, specB).frames[0]?.payload).toHaveLength(3);
    expect(findFrames(frameB, specB).frames[0]?.crcOk).toBe(true);
  });

  it('reads two-byte little-endian length fields', () => {
    const body = bytes(0x7e, 0x03, 0x00, 0x01, 0x02, 0x03);
    const spec = frameSpec({
      header: bytes(0x7e),
      lengthOffset: 0,
      lengthSize: 2,
      lengthBigEndian: false,
    });
    expect(Array.from(findFrames(body, spec).frames[0]?.payload ?? [])).toEqual([1, 2, 3]);
  });

  it('keeps the buffer small with a wrong layout', () => {
    const { rest } = findFrames(
      new Uint8Array(5000).fill(1),
      frameSpec({ header: bytes(0xff, 0xff), lengthOffset: 0 }),
    );
    expect(rest.length).toBeLessThan(10);
  });

  it('returns incomplete telegrams as remainder', () => {
    const { frames, rest } = findFrames(telegram.subarray(0, 4), specHeader);
    expect(frames).toHaveLength(0);
    expect(rest).toHaveLength(4);
  });

  it('handles an empty buffer', () => {
    const { frames, rest } = findFrames(new Uint8Array(), specHeader);
    expect(frames).toHaveLength(0);
    expect(rest).toHaveLength(0);
  });
});

describe('describeFrame', () => {
  it('summarises a valid frame', () => {
    const { frames } = findFrames(telegram, specHeader);
    const text = describeFrame(frames[0]!, specHeader);
    expect(text).toContain('Kopf AA 55');
    expect(text).toContain('Daten 11 22 33');
    expect(text).toContain('CRC ✓');
  });
  it('shows received and expected checksum on mismatch', () => {
    const bad = telegram.slice();
    bad[bad.length - 1] = 0x00;
    const { frames } = findFrames(bad, specHeader);
    expect(describeFrame(frames[0]!, specHeader)).toMatch(
      /CRC ✗ empfangen 00, erwartet [0-9A-F]{2}/,
    );
  });
});
