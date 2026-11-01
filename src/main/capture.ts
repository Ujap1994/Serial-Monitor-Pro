// Writes a session capture (format: src/shared/core/capture.ts) while it runs.

import { createWriteStream, type WriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import {
  encodeCaptureEvent,
  encodeCaptureHeader,
  type CaptureEvent,
  type CapturePort,
} from '@shared/core/capture';
import type { CaptureStats, OpenOptions } from '@shared/ipc';
import { now, type TapEvent } from './serial';

export function capturePort(options: OpenOptions): CapturePort {
  return {
    path: options.path,
    baudRate: options.baudRate,
    dataBits: options.dataBits,
    parity: options.parity,
    stopBits: options.stopBits,
    ...(options.flowControl && options.flowControl !== 'none'
      ? { flowControl: options.flowControl }
      : {}),
  };
}

export class CaptureWriter {
  private readonly stream: WriteStream;
  private readonly start = now();
  private failed: string | null = null;
  readonly stats: CaptureStats;

  constructor(path: string, app: string, options: OpenOptions | null) {
    this.stats = { path, durationMs: 0, rxBytes: 0, txBytes: 0, events: 0, error: null };
    this.stream = createWriteStream(path, { encoding: 'utf8' });
    this.stream.on('error', (error) => {
      this.failed = error.message;
      console.warn('[capture] write failed:', error);
    });
    this.stream.write(
      encodeCaptureHeader({
        created: new Date().toISOString(),
        app,
        ...(options ? { port: capturePort(options) } : {}),
      }),
    );
    // Already connected: the capture starts with the settings in effect.
    if (options) this.write({ t: 0, d: 'open', port: capturePort(options) });
  }

  private write(event: CaptureEvent): void {
    if (this.failed) return;
    this.stream.write(encodeCaptureEvent(event));
    this.stats.events++;
    this.stats.durationMs = Math.max(this.stats.durationMs, event.t);
    if (event.d === 'rx') this.stats.rxBytes += event.data.length;
    if (event.d === 'tx') this.stats.txBytes += event.data.length;
  }

  record(event: TapEvent): void {
    const t = Math.max(0, event.t - this.start);
    switch (event.d) {
      case 'rx':
      case 'tx':
        return this.write({ t, d: event.d, data: event.data });
      case 'open':
        return this.write({ t, d: 'open', port: capturePort(event.options) });
      case 'close':
        return this.write({ t, d: 'close', lost: event.lost });
      case 'lines':
        return this.write({ t, d: 'lines', dtr: event.lines.dtr, rts: event.lines.rts });
      case 'break':
        return this.write({ t, d: 'break', ms: event.ms });
    }
  }

  async finish(): Promise<CaptureStats> {
    const closed = finished(this.stream, { cleanup: true }).catch((error: unknown) => {
      this.failed ??= error instanceof Error ? error.message : String(error);
    });
    this.stream.end();
    await closed;
    return { ...this.stats, durationMs: Math.round(this.stats.durationMs), error: this.failed };
  }
}
