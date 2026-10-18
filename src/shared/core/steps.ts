// Steps of an automation sequence.

import { t } from '../i18n';
import { concatBytes, indexOfBytes } from './bytes';
import { isDataFormat, type DataFormat } from './format';
import { isNewline, type Newline } from './commands';

export const STEP_KINDS = ['send', 'wait', 'expect', 'log'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface Step {
  kind: StepKind;
  /** send/expect: payload or pattern. */
  data: string;
  fmt: DataFormat;
  newline: Newline;
  /** wait: duration in ms; expect: timeout in ms. */
  value: number;
  /** log: text for the protocol. */
  note: string;
}

export function newStep(partial: Partial<Step> = {}): Step {
  return { kind: 'send', data: '', fmt: 'HEX', newline: 'LF', value: 500, note: '', ...partial };
}

export function describeStep(step: Step): string {
  switch (step.kind) {
    case 'send':
      return t('step.describe.send', {
        fmt: step.fmt,
        data: step.data || '—',
        newline: step.newline,
      });
    case 'wait':
      return t('step.describe.wait', { ms: step.value });
    case 'expect':
      return t('step.describe.expect', { data: step.data, ms: step.value });
    case 'log':
      return t('step.describe.log', { note: step.note });
  }
}

/** Text value of a JSON field (numbers are accepted, objects are not). */
function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function normalizeStep(value: unknown): Step {
  const d = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const kind = (STEP_KINDS as readonly string[]).includes(String(d.kind))
    ? (d.kind as StepKind)
    : 'send';
  const n = Number(d.value);
  return {
    kind,
    data: text(d.data),
    fmt: isDataFormat(d.fmt) ? d.fmt : 'HEX',
    newline: isNewline(d.newline) ? d.newline : 'LF',
    value: Number.isFinite(n) && n >= 0 ? Math.round(n) : 500,
    note: text(d.note),
  };
}

/**
 * Collects received data for "expect response" steps.
 *
 * Everything received since the last send counts – a device often answers
 * within a few milliseconds, before the expect step has even started, and that
 * answer must not be lost. Data before the send is discarded: it cannot be the
 * answer to the request.
 */
export class ResponseWatcher {
  private buffer: Uint8Array = new Uint8Array();
  private needle: Uint8Array | null = null;

  get waiting(): boolean {
    return this.needle !== null;
  }

  /** A request goes out. */
  sent(): void {
    this.buffer = new Uint8Array();
  }

  /** Starts waiting for the pattern; true if it has already been received. */
  expect(needle: Uint8Array): boolean {
    this.needle = needle;
    return this.check();
  }

  /** Adds received data; true when the awaited pattern is now complete. */
  push(data: Uint8Array): boolean {
    this.buffer = concatBytes(this.buffer, data);
    if (this.buffer.length > 65536) this.buffer = this.buffer.slice(-8192);
    return this.check();
  }

  reset(): void {
    this.buffer = new Uint8Array();
    this.needle = null;
  }

  private check(): boolean {
    if (!this.needle) return false;
    const at = indexOfBytes(this.buffer, this.needle);
    if (at < 0) return false;
    // What follows the match may already answer the next expect step.
    this.buffer = this.buffer.slice(at + this.needle.length);
    this.needle = null;
    return true;
  }
}
