// Stop conditions – end a recording automatically.

import { t } from '../i18n';
import { concatBytes, countByte, indexOfBytes } from './bytes';
import { parseSendData } from './format';

export type StopMode = 'pattern' | 'bytes' | 'lines' | 'seconds';

export interface StopCondition {
  mode: StopMode;
  pattern: string;
  patternFmt: 'ASCII' | 'HEX';
  limit: number;
  /** Also close the connection. */
  disconnect: boolean;
}

export interface StopState {
  bytesSeen: number;
  linesSeen: number;
  started: number | null;
  /** Remainder of the previous packet, so patterns across packet borders are found. */
  tail: Uint8Array;
}

export function newStopState(now = Date.now()): StopState {
  return { bytesSeen: 0, linesSeen: 0, started: now, tail: new Uint8Array() };
}

export function stopNeedle(cond: StopCondition): Uint8Array {
  try {
    return parseSendData(cond.pattern, cond.patternFmt);
  } catch {
    return new Uint8Array();
  }
}

/**
 * Checks the condition after every packet (and periodically with an empty
 * packet so that "time elapsed" fires even when the device goes silent).
 *
 * When matching a pattern, the end of the previous packet is checked as well –
 * otherwise a pattern lying exactly on a packet border would be missed, which
 * is very common on serial lines.
 */
export function checkStop(
  cond: StopCondition,
  state: StopState,
  raw: Uint8Array,
  now = Date.now(),
): { hit: boolean; reason: string } {
  if (state.started === null) Object.assign(state, newStopState(now));

  state.bytesSeen += raw.length;
  state.linesSeen += countByte(raw, 0x0a);

  switch (cond.mode) {
    case 'pattern': {
      const needle = stopNeedle(cond);
      if (!needle.length) return { hit: false, reason: '' };
      const haystack = concatBytes(state.tail, raw);
      if (indexOfBytes(haystack, needle) >= 0) {
        return { hit: true, reason: t('stop.reason.pattern', { pattern: cond.pattern }) };
      }
      state.tail = needle.length > 1 ? haystack.slice(-(needle.length - 1)) : new Uint8Array();
      return { hit: false, reason: '' };
    }
    case 'bytes':
      return state.bytesSeen >= cond.limit
        ? { hit: true, reason: t('stop.reason.bytes', { count: state.bytesSeen }) }
        : { hit: false, reason: '' };
    case 'lines':
      return state.linesSeen >= cond.limit
        ? { hit: true, reason: t('stop.reason.lines', { count: state.linesSeen }) }
        : { hit: false, reason: '' };
    case 'seconds': {
      const passed = (now - (state.started ?? now)) / 1000;
      return passed >= cond.limit
        ? { hit: true, reason: t('stop.reason.seconds', { count: Math.floor(passed) }) }
        : { hit: false, reason: '' };
    }
  }
}
