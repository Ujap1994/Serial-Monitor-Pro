// Randomised robustness tests: thousands of generated inputs instead of a few
// hand-picked ones. The generator is seeded, so every failure is reproducible –
// the case number is part of the assertion message.
//
// The central property is stream invariance: a serial line splits data at
// arbitrary points, so every stream consumer must produce the same result no
// matter where the chunk borders fall.

import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import { MAX_ENTRY_BYTES, StreamAssembler, type TimedBytes } from '@shared/core/assembler';
import { bytesEqual, concatBytes, toHexString } from '@shared/core/bytes';
import { calculateCrc, CRC_NAMES } from '@shared/core/crc';
import { findFrames, frameSpec, type FrameSpec, type LengthCounts } from '@shared/core/frames';
import { formatBytes, InputError, parseSendData } from '@shared/core/format';
import { buildModbusFrame, decodeModbusRtu } from '@shared/core/modbus';
import { decodeNmea, withNmeaChecksum } from '@shared/core/nmea';
import { checkStop, newStopState, type StopCondition } from '@shared/core/stop';
import { extractValues } from '@shared/core/values';

beforeAll(() => setLanguage('en'));

/** mulberry32 – small, fast and good enough to generate test data. */
function random(seed: number) {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  const bytes = (min: number, max: number): Uint8Array =>
    Uint8Array.from({ length: int(min, max) }, () => int(0, 255));
  /** Splits data at random points, including empty chunks. */
  const chunks = (data: Uint8Array): Uint8Array[] => {
    const out: Uint8Array[] = [];
    let pos = 0;
    while (pos < data.length) {
      const size = next() < 0.1 ? 0 : int(1, 24);
      out.push(data.slice(pos, pos + size));
      pos += size;
    }
    return out;
  };
  return { next, int, pick, bytes, chunks };
}

type Random = ReturnType<typeof random>;
const CASES = 400;

// ── Frame parser ──────────────────────────────────────────────────────────────

function randomSpec(r: Random): FrameSpec {
  const lengthOffset = r.next() < 0.5 ? -1 : r.int(0, 2);
  const footer = r.next() < 0.3 ? r.bytes(1, 2) : new Uint8Array();
  return frameSpec({
    header: r.next() < 0.8 ? r.bytes(1, 3) : new Uint8Array(),
    footer,
    lengthOffset,
    lengthSize: r.pick([1, 2]),
    lengthBigEndian: r.next() < 0.5,
    lengthCounts: r.pick<LengthCounts>(['payload', 'payload_crc', 'frame']),
    crcAlgo: r.next() < 0.5 ? '' : r.pick(CRC_NAMES),
    crcBigEndian: r.next() < 0.5,
    fixedLength: lengthOffset < 0 && !footer.length ? r.int(1, 12) : 0,
  });
}

/** Feeds the chunks like the frame parser page does: the rest goes in front of the next chunk. */
function parseStream(parts: Uint8Array[], spec: FrameSpec): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest: Uint8Array = new Uint8Array();
  for (const part of parts) {
    const result = findFrames(concatBytes(rest, part), spec);
    frames.push(...result.frames.map((f) => toHexString(f.raw)));
    rest = result.rest;
  }
  return { frames, rest: toHexString(rest) };
}

describe('frame parser with random layouts and data', () => {
  it('finds the same frames no matter how the stream is split', () => {
    const r = random(1);
    for (let n = 0; n < CASES * 2; n++) {
      const spec = randomSpec(r);
      // Sprinkle in copies of the header so that frames actually start.
      const pieces = Array.from({ length: r.int(1, 12) }, () =>
        r.next() < 0.5 ? concatBytes(spec.header, r.bytes(0, 12)) : r.bytes(0, 8),
      );
      const data = concatBytes(...pieces);
      const whole = parseStream([data], spec);
      const split = parseStream(r.chunks(data), spec);
      expect(split, `case ${n}`).toEqual(whole);
    }
  });

  it('returns frames and a remainder that are both taken from the input', () => {
    const r = random(2);
    for (let n = 0; n < CASES; n++) {
      const spec = randomSpec(r);
      const data = concatBytes(spec.header, r.bytes(0, 64), spec.header, r.bytes(0, 16));
      const { frames, rest } = findFrames(data, spec);
      const hex = toHexString(data);
      for (const f of frames) expect(hex, `case ${n}`).toContain(toHexString(f.raw));
      expect(hex.endsWith(toHexString(rest)), `case ${n}`).toBe(true);
      const used = frames.reduce((sum, f) => sum + f.raw.length, 0) + rest.length;
      expect(used, `case ${n}`).toBeLessThanOrEqual(data.length);
    }
  });

  it('recovers every valid telegram between random garbage', () => {
    const r = random(3);
    const spec = frameSpec({
      header: Uint8Array.of(0xaa, 0x55),
      lengthOffset: 0,
      lengthSize: 1,
      lengthCounts: 'payload',
      crcAlgo: 'CRC-16/MODBUS',
      crcBigEndian: false,
    });
    for (let n = 0; n < CASES; n++) {
      const telegrams: Uint8Array[] = [];
      const pieces: Uint8Array[] = [];
      for (let i = r.int(1, 8); i > 0; i--) {
        // Garbage without 0xAA cannot contain a false header.
        pieces.push(r.bytes(0, 10).map((b) => (b === 0xaa ? 0x00 : b)));
        const payload = r.bytes(0, 20);
        const covered = concatBytes(spec.header, Uint8Array.of(payload.length), payload);
        const crc = calculateCrc(covered, spec.crcAlgo);
        const telegram = concatBytes(covered, Uint8Array.of(crc & 0xff, crc >> 8));
        telegrams.push(telegram);
        pieces.push(telegram);
      }
      const result = parseStream(r.chunks(concatBytes(...pieces)), spec);
      expect(result.frames, `case ${n}`).toEqual(telegrams.map((t) => toHexString(t)));
    }
  });
});

// ── Line assembly ─────────────────────────────────────────────────────────────

function assemble(
  parts: Uint8Array[],
  mode: 'newline' | 'packet',
  times: number[],
  timeoutMs: number,
): TimedBytes[] {
  const asm = new StreamAssembler(mode, timeoutMs);
  const out: TimedBytes[] = [];
  parts.forEach((data, i) => out.push(...asm.push({ t: times[i] ?? 0, data })));
  const last = asm.flushAll();
  if (last) out.push(last);
  return out;
}

/** Bytes with plenty of CR and LF so that every line-break rule is exercised. */
function lineBytes(r: Random, max: number): Uint8Array {
  return Uint8Array.from({ length: r.int(0, max) }, () =>
    r.pick([0x0a, 0x0d, 0x41, 0x42, r.int(0, 255)]),
  );
}

describe('line assembly with random streams', () => {
  it('never loses, duplicates or reorders a byte', () => {
    const r = random(4);
    for (let n = 0; n < CASES; n++) {
      const data = lineBytes(r, 9000);
      const parts = r.chunks(data);
      let t = 0;
      const times = parts.map(() => (t += r.pick([0, 1, 5, 50])));
      const entries = assemble(parts, r.pick(['newline', 'packet']), times, r.pick([1, 10, 30]));
      const joined = concatBytes(...entries.map((e) => e.data));
      expect(bytesEqual(joined, data), `case ${n}`).toBe(true);
      const sizes = entries.map((e) => e.data.length);
      expect(Math.min(...sizes, 1), `case ${n}`).toBeGreaterThan(0);
      expect(Math.max(...sizes, 0), `case ${n}`).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    }
  });

  it('produces the same lines no matter how the stream is split', () => {
    const r = random(5);
    for (let n = 0; n < CASES; n++) {
      const data = lineBytes(r, 9000);
      const mode = r.pick(['newline', 'packet'] as const);
      // Without pauses only the content decides where an entry ends.
      const whole = assemble([data], mode, [0], 1000).map((e) => toHexString(e.data));
      const parts = r.chunks(data);
      const split = assemble(parts, mode, new Array<number>(parts.length).fill(0), 1000);
      expect(
        split.map((e) => toHexString(e.data)),
        `case ${n}`,
      ).toEqual(whole);
    }
  });

  it('ends a line only at LF, a lone CR or the size limit', () => {
    const r = random(6);
    // Thousands of entries per case – collect violations instead of asserting each.
    const violations: string[] = [];
    for (let n = 0; n < CASES; n++) {
      const entries = assemble([lineBytes(r, 9000)], 'newline', [0], 1000);
      entries.forEach((e, i) => {
        const last = e.data[e.data.length - 1];
        const loneCr = last === 0x0d && entries[i + 1]?.data[0] !== 0x0a;
        const isLast = i === entries.length - 1;
        if (!isLast && last !== 0x0a && !loneCr && e.data.length !== MAX_ENTRY_BYTES) {
          violations.push(`case ${n}, entry ${i}: ends with ${last}`);
        }
        if (e.data.subarray(0, -1).includes(0x0a))
          violations.push(`case ${n}, entry ${i}: inner LF`);
      });
    }
    expect(violations).toEqual([]);
  });
});

// ── Stop condition ────────────────────────────────────────────────────────────

describe('stop on pattern with random packet borders', () => {
  it('fires on exactly the packet that completes the pattern', () => {
    const r = random(7);
    for (let n = 0; n < CASES; n++) {
      const needle = r.bytes(1, 6);
      const data = concatBytes(r.bytes(0, 60), needle, r.bytes(0, 20));
      const cond: StopCondition = {
        mode: 'pattern',
        pattern: formatBytes(needle, 'HEX'),
        patternFmt: 'HEX',
        limit: 0,
        disconnect: false,
      };
      const state = newStopState(0);
      const hex = toHexString(needle);
      let seen: Uint8Array = new Uint8Array();
      for (const part of r.chunks(data)) {
        seen = concatBytes(seen, part);
        const expected = ` ${toHexString(seen)} `.includes(` ${hex} `);
        expect(checkStop(cond, state, part, 0).hit, `case ${n}`).toBe(expected);
        if (expected) break;
      }
    }
  });
});

// ── Input parsing and decoders ────────────────────────────────────────────────

describe('send input and decoders with random data', () => {
  it('parses what it displays (HEX, DEC, BIN)', () => {
    const r = random(8);
    for (let n = 0; n < CASES; n++) {
      const data = r.bytes(0, 40);
      for (const fmt of ['HEX', 'DEC', 'BIN'] as const) {
        expect(toHexString(parseSendData(formatBytes(data, fmt), fmt)), `case ${n} ${fmt}`).toBe(
          toHexString(data),
        );
      }
    }
  });

  it('either parses arbitrary input or explains the problem', () => {
    const r = random(9);
    const alphabet = '0123456789abcdefABCDEFxX ,;-\t\n:#gzü€';
    for (let n = 0; n < CASES * 2; n++) {
      const text = Array.from({ length: r.int(0, 30) }, () => r.pick([...alphabet])).join('');
      for (const fmt of ['ASCII', 'HEX', 'DEC', 'BIN'] as const) {
        try {
          const out = parseSendData(text, fmt);
          expect(out, `case ${n} ${fmt}`).toBeInstanceOf(Uint8Array);
        } catch (err) {
          expect(err, `case ${n} ${fmt}: ${JSON.stringify(text)}`).toBeInstanceOf(InputError);
        }
      }
    }
  });

  it('decodes random bytes as Modbus without throwing', () => {
    const r = random(10);
    for (let n = 0; n < CASES * 2; n++) {
      expect(typeof decodeModbusRtu(r.bytes(0, 40)), `case ${n}`).toBe('string');
    }
  });

  it('accepts the checksum of every Modbus telegram it builds', () => {
    const r = random(11);
    for (let n = 0; n < CASES; n++) {
      const body = r.bytes(2, 40);
      expect(decodeModbusRtu(buildModbusFrame(body)), `case ${n}`).toContain('CRC ✓');
    }
  });

  it('decodes random text as NMEA without throwing and verifies its own checksums', () => {
    const r = random(12);
    const alphabet = 'GPRMCGGA,.*$0123456789ABCDEFNSEW \t';
    for (let n = 0; n < CASES * 2; n++) {
      const text = Array.from({ length: r.int(0, 60) }, () => r.pick([...alphabet])).join('');
      expect(typeof decodeNmea(text), `case ${n}`).toBe('string');
      const body = text.replace(/[*$\s]/g, '');
      const ok = decodeNmea(withNmeaChecksum(body));
      expect(ok, `case ${n}: ${body}`).toContain(
        decodeNmea(withNmeaChecksum('GPXXX')).split('  |  ').pop(),
      );
    }
  });

  it('extracts only finite numbers for the graph', () => {
    const r = random(13);
    const token = (): string =>
      r.pick([
        () => String(r.int(-1000, 1000)),
        () => `${r.int(0, 9)}.${r.int(0, 999)}`,
        () => `${r.int(1, 9)}e${r.int(-400, 400)}`,
        () =>
          `${r.pick(['t', 'temp', 'U', ''])}${r.pick([':', '='])}${r.int(-50, 50)},${r.int(0, 9)}`,
        () => r.pick(['NaN', 'Infinity', '-', '.', 'e5', '1e', '0x1F', '']),
      ])();
    for (let n = 0; n < CASES * 2; n++) {
      const line = Array.from({ length: r.int(0, 6) }, token).join(r.pick([',', ';', ' ']));
      for (const mode of ['auto', 'labeled', 'separated'] as const) {
        for (const value of Object.values(extractValues(line, mode))) {
          expect(Number.isFinite(value), `case ${n} ${mode}: ${JSON.stringify(line)}`).toBe(true);
        }
      }
    }
  });
});
