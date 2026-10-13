// Small byte helpers shared by the main process, the renderer and the tests.

const encoder = new TextEncoder();

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function decodeUtf8(raw: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(raw);
}

/** Decodes bytes as Latin-1 / ASCII (one char per byte, never fails). */
export function decodeLatin1(raw: Uint8Array): string {
  let out = '';
  for (const b of raw) out += String.fromCharCode(b);
  return out;
}

export function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/** "01 AB FF" */
export function toHexString(raw: Uint8Array, separator = ' '): string {
  return Array.from(raw, hex2).join(separator);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Position of `needle` in `haystack` starting at `from`, or -1. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0) return from <= haystack.length ? from : -1;
  const last = haystack.length - needle.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function countByte(raw: Uint8Array, value: number): number {
  let n = 0;
  for (const b of raw) if (b === value) n++;
  return n;
}

/** Unsigned integer from bytes (max. 4 bytes). */
export function readUInt(raw: Uint8Array, bigEndian: boolean): number {
  let value = 0;
  if (bigEndian) {
    for (const b of raw) value = value * 256 + b;
  } else {
    for (let i = raw.length - 1; i >= 0; i--) value = value * 256 + (raw[i] ?? 0);
  }
  return value;
}

/** Unsigned integer to `size` bytes. */
export function writeUInt(value: number, size: number, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(size);
  let v = value;
  for (let i = 0; i < size; i++) {
    const b = v % 256;
    v = Math.floor(v / 256);
    out[bigEndian ? size - 1 - i : i] = b;
  }
  return out;
}
