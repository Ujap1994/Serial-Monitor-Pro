import { describe, expect, it, vi } from 'vitest';
import { setLanguage } from '@shared/i18n';
import {
  entriesToCsv,
  lineToText,
  MonitorModel,
  renderEntry,
  type Entry,
  type RenderOptions,
} from '../../src/renderer/src/lib/monitor';
import { ascii, bytes } from './helpers';

setLanguage('en');

const base: RenderOptions = {
  display: 'ASCII',
  utf8: false,
  showCrlf: false,
  hexdump: false,
  timestamp: false,
  timestampFormat: 'time-ms',
  deltaTime: false,
};
const rx = (data: Uint8Array, extra: Partial<Entry> = {}): Entry => ({
  id: 1,
  t: Date.now(),
  kind: 'rx',
  raw: data,
  ...extra,
});

describe('renderEntry', () => {
  it('drops the line ending that ended the line', () => {
    expect(renderEntry(rx(ascii('Hello\r\n')), base).text).toBe('Hello');
  });
  it('shows control characters on request', () => {
    expect(renderEntry(rx(ascii('A\tB\r\n')), { ...base, showCrlf: true }).text).toBe(
      'A\\tB\\r\\n',
    );
  });
  it('renders the selected format', () => {
    expect(renderEntry(rx(ascii('AB')), { ...base, display: 'HEX' }).text).toBe('41 42');
    expect(renderEntry(rx(ascii('AB')), { ...base, display: 'DEC' }).text).toBe('65 66');
  });
  it('renders hex dumps', () => {
    expect(renderEntry(rx(ascii('AB')), { ...base, hexdump: true }).text).toMatch(
      /^00000000 {2}41 42/,
    );
  });
  it('adds timestamp and delta time', () => {
    const line = renderEntry(rx(ascii('x'), { delta: 12.34 }), {
      ...base,
      timestamp: true,
      deltaTime: true,
    });
    expect(line.ts).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/);
    expect(line.dt).toBe('[Δ    12.3 ms]');
  });
  it('labels sent commands and keeps their format', () => {
    const tx: Entry = { id: 2, t: 0, kind: 'tx', raw: bytes(1, 2), fmt: 'HEX', label: 'Read' };
    expect(renderEntry(tx, base).text).toBe('[Read] 01 02');
    expect(renderEntry(tx, base).dir).toBe('→');
  });
  it('produces plain text lines', () => {
    expect(lineToText({ ts: '[t]', dt: '', dir: '←', text: 'x' })).toBe('[t] ← x');
  });
});

describe('entriesToCsv', () => {
  it('writes one row per entry with a header and BOM', () => {
    const csv = entriesToCsv(
      [rx(ascii('a;b\r\n')), { id: 2, t: 0, kind: 'sys', text: 'connected' }],
      ['Time', 'Dir', 'Bytes', 'HEX', 'Text'],
    );
    const rows = csv.replace('﻿', '').trim().split('\r\n');
    expect(rows[0]).toBe('Time;Dir;Bytes;HEX;Text');
    expect(rows[1]).toMatch(/;RX;5;61 3B 62 0D 0A;"a;b"$/);
    expect(rows[2]).toMatch(/;SYS;0;;connected$/);
  });
});

describe('MonitorModel', () => {
  it('delivers entries in batches and trims old ones', () => {
    vi.useFakeTimers();
    const model = new MonitorModel();
    model.setMax(1000);
    const batches: number[] = [];
    let firstId = 0;
    model.appended.on((e) => batches.push(e.length));
    model.trimmed.on((id) => (firstId = id));
    for (let i = 0; i < 1100; i++) model.add({ kind: 'rx', t: i, raw: ascii('x') });
    vi.advanceTimersByTime(20);
    expect(model.size).toBeLessThanOrEqual(1000);
    expect(firstId).toBeGreaterThan(1);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(model.size);
    vi.useRealTimers();
  });

  it('clears everything', () => {
    const model = new MonitorModel();
    const reset = vi.fn();
    model.reset.on(reset);
    model.add({ kind: 'sys', t: 0, text: 'x' });
    model.clear();
    expect(model.size).toBe(0);
    expect(reset).toHaveBeenCalledOnce();
  });
});
