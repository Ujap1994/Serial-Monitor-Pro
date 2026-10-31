// Triggers, schedules and macro recording – the automation tools of the
// former Python version, rebuilt on the byte-exact send path of this app.
//
//  Trigger   – when a pattern is received, send a response
//  Schedule  – send data every N seconds
//  Macro     – record manual sends (with the pauses in between) as sequence steps

import { decodeLatin1, indexOfBytes, toHexString } from './bytes';
import { isDataFormat, parseSendData, type DataFormat } from './format';
import { isNewline, type Newline } from './newline';
import { newStep, type Step } from './steps';

export const TRIGGER_MATCHES = ['ASCII', 'HEX', 'REGEX'] as const;
export type TriggerMatch = (typeof TRIGGER_MATCHES)[number];

export interface Trigger {
  name: string;
  /** ASCII/HEX: byte sequence anywhere in the data; REGEX: per received line. */
  match: TriggerMatch;
  pattern: string;
  response: string;
  fmt: DataFormat;
  newline: Newline;
  /** Minimum pause between two firings – protects against echo loops. */
  cooldownMs: number;
  enabled: boolean;
}

export interface Schedule {
  name: string;
  /** Seconds between two sends (Python: interval in seconds). */
  intervalS: number;
  data: string;
  fmt: DataFormat;
  newline: Newline;
  enabled: boolean;
}

export const TRIGGER_COOLDOWN_MAX = 3_600_000;
export const SCHEDULE_INTERVAL_MAX = 86_400;

export function newTrigger(partial: Partial<Trigger> = {}): Trigger {
  return {
    name: '',
    match: 'ASCII',
    pattern: '',
    response: '',
    fmt: 'ASCII',
    newline: 'CRLF',
    cooldownMs: 500,
    enabled: true,
    ...partial,
  };
}

export function newSchedule(partial: Partial<Schedule> = {}): Schedule {
  return {
    name: '',
    intervalS: 10,
    data: '',
    fmt: 'ASCII',
    newline: 'CRLF',
    enabled: true,
    ...partial,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function dict(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeTrigger(value: unknown): Trigger {
  const d = dict(value);
  const D = newTrigger();
  return {
    name: text(d.name),
    match: (TRIGGER_MATCHES as readonly unknown[]).includes(d.match)
      ? (d.match as TriggerMatch)
      : D.match,
    pattern: text(d.pattern),
    response: text(d.response),
    fmt: isDataFormat(d.fmt) ? d.fmt : D.fmt,
    newline: isNewline(d.newline) ? d.newline : D.newline,
    cooldownMs: clampInt(d.cooldownMs, D.cooldownMs, 0, TRIGGER_COOLDOWN_MAX),
    enabled: typeof d.enabled === 'boolean' ? d.enabled : true,
  };
}

export function normalizeSchedule(value: unknown): Schedule {
  const d = dict(value);
  const D = newSchedule();
  return {
    name: text(d.name),
    intervalS: clampInt(d.intervalS ?? d.interval, D.intervalS, 1, SCHEDULE_INTERVAL_MAX),
    data: text(d.data),
    fmt: isDataFormat(d.fmt) ? d.fmt : D.fmt,
    newline: isNewline(d.newline) ? d.newline : D.newline,
    enabled: typeof d.enabled === 'boolean' ? d.enabled : true,
  };
}

export function normalizeList<T>(value: unknown, normalize: (v: unknown) => T, max = 200): T[] {
  return Array.isArray(value) ? value.slice(0, max).map(normalize) : [];
}

/** Checks a trigger pattern; returns an error text or '' when it is usable. */
export function triggerPatternError(trigger: Pick<Trigger, 'match' | 'pattern'>): string {
  if (!trigger.pattern.trim()) return 'empty';
  try {
    if (trigger.match === 'REGEX') new RegExp(trigger.pattern);
    else if (!parseSendData(trigger.pattern, trigger.match).length) return 'empty';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return '';
}

interface Compiled {
  bytes: Uint8Array | null;
  regex: RegExp | null;
}

function compile(trigger: Trigger): Compiled {
  try {
    if (trigger.match === 'REGEX') return { bytes: null, regex: new RegExp(trigger.pattern) };
    const bytes = parseSendData(trigger.pattern, trigger.match);
    return { bytes: bytes.length ? bytes : null, regex: null };
  } catch {
    return { bytes: null, regex: null };
  }
}

/**
 * Finds trigger patterns in received data. Byte patterns are also found when
 * they straddle two packets; regular expressions are applied to complete
 * lines. A trigger fires at most once per received packet and never again
 * within its cooldown.
 */
export class TriggerMatcher {
  private tail = new Uint8Array();
  private line = '';
  private lastFired = new Map<number, number>();

  reset(): void {
    this.tail = new Uint8Array();
    this.line = '';
    this.lastFired.clear();
  }

  /** Returns the indexes of the triggers that fire for this packet. */
  push(data: Uint8Array, triggers: readonly Trigger[], now: number): number[] {
    const compiled = triggers.map((tr) => (tr.enabled ? compile(tr) : null));
    const longest = Math.max(1, ...compiled.map((c) => c?.bytes?.length ?? 0));
    const haystack = new Uint8Array(this.tail.length + data.length);
    haystack.set(this.tail);
    haystack.set(data, this.tail.length);
    const tailLength = this.tail.length;

    this.line += decodeLatin1(data);
    const lines = this.line.split('\n');
    this.line = (lines.pop() ?? '').slice(-4096);

    const fired: number[] = [];
    compiled.forEach((c, i) => {
      if (!c) return;
      let hit = false;
      if (c.bytes) {
        // Only matches that end in the new data – older ones were reported before.
        hit = indexOfBytes(haystack, c.bytes, Math.max(0, tailLength - c.bytes.length + 1)) >= 0;
      } else if (c.regex) {
        hit = lines.some((l) => c.regex!.test(l.replace(/\r$/, '')));
      }
      if (!hit) return;
      const cooldown = triggers[i]?.cooldownMs ?? 0;
      const last = this.lastFired.get(i);
      if (last !== undefined && now - last < cooldown) return;
      this.lastFired.set(i, now);
      fired.push(i);
    });
    this.tail = longest > 1 ? haystack.slice(-(longest - 1)) : new Uint8Array();
    return fired;
  }
}

/** Indexes of the schedules that are due; updates `lastRun` for them. */
export function dueSchedules(
  schedules: readonly Schedule[],
  lastRun: Map<number, number>,
  now: number,
): number[] {
  const due: number[] = [];
  schedules.forEach((s, i) => {
    if (!s.enabled) return;
    const last = lastRun.get(i);
    if (last === undefined || now - last >= s.intervalS * 1000) {
      lastRun.set(i, now);
      due.push(i);
    }
  });
  return due;
}

/**
 * Records manual sends as sequence steps: a "wait" for each pause of at least
 * 10 ms, then the exact bytes that went out (HEX, without an extra line ending).
 */
export class MacroRecorder {
  private steps: Step[] = [];
  private last: number | null = null;

  start(now: number): void {
    this.steps = [];
    this.last = now;
  }

  record(data: Uint8Array, now: number): void {
    if (this.last === null || !data.length) return;
    const pause = Math.round(now - this.last);
    if (pause >= 10) this.steps.push(newStep({ kind: 'wait', value: pause }));
    this.steps.push(
      newStep({ kind: 'send', data: toHexString(data), fmt: 'HEX', newline: 'None' }),
    );
    this.last = now;
  }

  get count(): number {
    return this.steps.filter((s) => s.kind === 'send').length;
  }

  stop(): Step[] {
    const steps = this.steps;
    this.steps = [];
    this.last = null;
    return steps;
  }
}
