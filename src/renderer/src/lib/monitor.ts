// Monitor content model.
//
// Entries keep their raw bytes. Display options (format, timestamps, hex dump,
// filter …) are applied while rendering, so switching from ASCII to HEX
// re-renders everything that has already been received.

import { formatBytes, formatText, hexdump, type DataFormat } from '@shared/core/format';
import { formatTimestamp, type TimestampFormat } from '@shared/core/timestamp';
import { toHexString, decodeUtf8 } from '@shared/core/bytes';
import { Emitter } from './store';

export type EntryKind = 'rx' | 'tx' | 'sys' | 'err' | 'ok';

export interface Entry {
  id: number;
  /** Epoch milliseconds (fractional). */
  t: number;
  kind: EntryKind;
  raw?: Uint8Array;
  text?: string;
  /** Format the data was sent in (TX). */
  fmt?: DataFormat;
  /** Name of a stored command (TX). */
  label?: string;
  /** Milliseconds since the previous received entry (RX). */
  delta?: number | null;
}

export interface RenderOptions {
  display: DataFormat;
  utf8: boolean;
  showCrlf: boolean;
  hexdump: boolean;
  timestamp: boolean;
  timestampFormat: TimestampFormat;
  deltaTime: boolean;
}

export interface RenderedLine {
  ts: string;
  dt: string;
  dir: string;
  text: string;
}

const MARKERS: Record<EntryKind, string> = { rx: '←', tx: '→', sys: '•', err: '✕', ok: '✓' };

function renderData(raw: Uint8Array, fmt: DataFormat, o: RenderOptions, dump: boolean): string {
  if (dump) return hexdump(raw);
  if (fmt !== 'ASCII') return formatBytes(raw, fmt);
  let text = formatText(raw, o.utf8);
  if (o.showCrlf) return text.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  // The line break that ended the line is implied by the layout.
  text = text.replace(/(\r\n|\n|\r)$/, '');
  return text.replace(/\r\n?/g, '\n');
}

export function renderEntry(e: Entry, o: RenderOptions): RenderedLine {
  const ts = o.timestamp ? `[${formatTimestamp(e.t, o.timestampFormat)}]` : '';
  let dt = '';
  if (o.deltaTime && e.kind === 'rx') {
    dt = `[Δ${(e.delta ?? 0).toFixed(1).padStart(8)} ms]`;
  }
  let text: string;
  if (e.raw && e.kind === 'rx') {
    text = renderData(e.raw, o.display, o, o.hexdump);
  } else if (e.raw && e.kind === 'tx') {
    const data = renderData(e.raw, e.fmt ?? o.display, o, false);
    text = e.label ? `[${e.label}] ${data}` : data;
  } else {
    text = e.text ?? '';
  }
  return { ts, dt, dir: MARKERS[e.kind], text };
}

/** Plain-text form of a line (export, file log, clipboard). */
export function lineToText(line: RenderedLine): string {
  return [line.ts, line.dt, line.dir, line.text].filter(Boolean).join(' ');
}

const DIRECTIONS: Record<EntryKind, string> = {
  rx: 'RX',
  tx: 'TX',
  sys: 'SYS',
  err: 'ERR',
  ok: 'SYS',
};

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV with one row per entry – opens directly in Excel / LibreOffice. */
export function entriesToCsv(entries: readonly Entry[], header: string[]): string {
  const rows = [header.join(';')];
  for (const e of entries) {
    const time = new Date(e.t).toISOString();
    const raw = e.raw ?? new Uint8Array();
    const text = e.raw ? decodeUtf8(raw).replace(/\r?\n$/, '') : (e.text ?? '');
    rows.push(
      [
        time,
        DIRECTIONS[e.kind],
        String(raw.length),
        toHexString(raw),
        e.label ? `[${e.label}] ${text}` : text,
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  // BOM so Excel recognises UTF-8.
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

export class MonitorModel {
  private entries: Entry[] = [];
  private nextId = 1;
  private max = 20000;
  private queue: Entry[] = [];
  private scheduled = false;

  /** New entries (batched, about 60 times per second at most). */
  readonly appended = new Emitter<Entry[]>();
  /** Everything changed (clear) – views re-render. */
  readonly reset = new Emitter<void>();
  /** Entries with an id below this value were dropped. */
  readonly trimmed = new Emitter<number>();

  setMax(max: number): void {
    this.max = max;
    this.trim();
  }

  all(): readonly Entry[] {
    return this.entries;
  }

  get size(): number {
    return this.entries.length;
  }

  add(entry: Omit<Entry, 'id'>): Entry {
    const full: Entry = { ...entry, id: this.nextId++ };
    this.entries.push(full);
    this.queue.push(full);
    this.trim();
    if (!this.scheduled) {
      // A timer instead of requestAnimationFrame: animation frames pause while
      // the window is minimised, timers keep running.
      this.scheduled = true;
      setTimeout(() => this.deliver(), 16);
    }
    return full;
  }

  private deliver(): void {
    this.scheduled = false;
    const batch = this.queue;
    this.queue = [];
    const first = this.entries[0]?.id ?? this.nextId;
    const visible = batch.filter((e) => e.id >= first);
    if (visible.length) this.appended.emit(visible);
  }

  private trim(): void {
    // Drop in steps of 5 % so the view does not have to update for every line.
    if (this.entries.length <= this.max) return;
    const drop = this.entries.length - this.max + Math.ceil(this.max * 0.05);
    this.entries.splice(0, drop);
    this.trimmed.emit(this.entries[0]?.id ?? this.nextId);
  }

  clear(): void {
    this.entries = [];
    this.queue = [];
    this.reset.emit();
  }
}
