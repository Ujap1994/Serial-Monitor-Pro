// Groups the raw byte stream into display entries.
//
// A serial line delivers data in arbitrary pieces – "Hel" + "lo\n" is common.
// Showing every piece as its own line (with its own timestamp) tears text
// apart, so the stream is assembled first:
//
//   newline – one entry per line (LF, CRLF or a lone CR). An incomplete line is
//             shown after a short pause so binary data still appears promptly.
//   packet  – everything that arrives without a pause forms one entry, which
//             matches how most binary protocols separate their telegrams.

import type { RxSplit } from './settings';

export interface TimedBytes {
  /** Epoch milliseconds (fractional) of the first byte. */
  t: number;
  data: Uint8Array;
}

/** Upper bound for a single entry – protects the view against endless lines. */
export const MAX_ENTRY_BYTES = 4096;

export class StreamAssembler {
  private parts: number[] = [];
  private startedAt = 0;
  private lastAt = 0;

  constructor(
    private mode: RxSplit,
    private timeoutMs: number,
  ) {}

  configure(mode: RxSplit, timeoutMs: number): void {
    this.mode = mode;
    this.timeoutMs = timeoutMs;
  }

  get pending(): boolean {
    return this.parts.length > 0;
  }

  /** Adds received bytes and returns the entries completed by them. */
  push(chunk: TimedBytes): TimedBytes[] {
    const out: TimedBytes[] = [];
    // A pause before this chunk ends the previous entry.
    if (this.parts.length && chunk.t - this.lastAt >= this.timeoutMs) out.push(this.take());
    this.lastAt = chunk.t;

    if (this.mode === 'packet') {
      for (const b of chunk.data) {
        if (!this.parts.length) this.startedAt = chunk.t;
        this.parts.push(b);
        if (this.parts.length >= MAX_ENTRY_BYTES) out.push(this.take());
      }
      return out;
    }

    const data = chunk.data;
    for (let i = 0; i < data.length; i++) {
      const b = data[i] ?? 0;
      // A lone CR (not followed by LF) also ends a line.
      if (this.parts.length && this.parts[this.parts.length - 1] === 0x0d && b !== 0x0a) {
        out.push(this.take());
      }
      if (!this.parts.length) this.startedAt = chunk.t;
      this.parts.push(b);
      if (b === 0x0a || this.parts.length >= MAX_ENTRY_BYTES) out.push(this.take());
    }
    return out;
  }

  /** Returns the pending entry once no data arrived for the timeout. */
  flush(now: number): TimedBytes | null {
    if (!this.parts.length || now - this.lastAt < this.timeoutMs) return null;
    return this.take();
  }

  /** Returns whatever is pending, regardless of the timeout. */
  flushAll(): TimedBytes | null {
    return this.parts.length ? this.take() : null;
  }

  reset(): void {
    this.parts = [];
  }

  private take(): TimedBytes {
    const entry = { t: this.startedAt, data: Uint8Array.from(this.parts) };
    this.parts = [];
    return entry;
  }
}
