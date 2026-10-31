import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import {
  dueSchedules,
  MacroRecorder,
  newSchedule,
  newTrigger,
  normalizeList,
  normalizeSchedule,
  normalizeTrigger,
  TriggerMatcher,
  triggerPatternError,
} from '@shared/core/automation';
import { normalizeSettings } from '@shared/core/settings';
import { ascii, hex } from './helpers';

beforeAll(() => setLanguage('en'));

describe('trigger matching', () => {
  it('finds a text pattern that straddles two packets, exactly once', () => {
    const m = new TriggerMatcher();
    const triggers = [newTrigger({ pattern: 'ERROR', cooldownMs: 0 })];
    expect(m.push(ascii('xxER'), triggers, 0)).toEqual([]);
    expect(m.push(ascii('ROR yy'), triggers, 1)).toEqual([0]);
    // The match is already reported; the remaining tail must not report it again.
    expect(m.push(ascii('zz'), triggers, 2)).toEqual([]);
  });

  it('does not report a short pattern twice when a longer one keeps a longer tail', () => {
    const m = new TriggerMatcher();
    const triggers = [
      newTrigger({ pattern: 'OK', cooldownMs: 0 }),
      newTrigger({ pattern: 'LONGPATTERN', cooldownMs: 0 }),
    ];
    expect(m.push(ascii('..OK'), triggers, 0)).toEqual([0]);
    expect(m.push(ascii('..'), triggers, 1)).toEqual([]);
  });

  it('matches HEX byte sequences', () => {
    const m = new TriggerMatcher();
    const triggers = [newTrigger({ match: 'HEX', pattern: '06', cooldownMs: 0 })];
    expect(m.push(hex('01 02 06 03'), triggers, 0)).toEqual([0]);
    expect(m.push(hex('15'), triggers, 1)).toEqual([]);
  });

  it('applies regular expressions to complete lines only', () => {
    const m = new TriggerMatcher();
    const triggers = [newTrigger({ match: 'REGEX', pattern: '^ERR\\d+$', cooldownMs: 0 })];
    expect(m.push(ascii('ERR4'), triggers, 0)).toEqual([]);
    expect(m.push(ascii('2\r\nOK\r\n'), triggers, 1)).toEqual([0]);
    expect(m.push(ascii('xERR1\n'), triggers, 2)).toEqual([]);
  });

  it('respects the cooldown, which protects against echo loops', () => {
    const m = new TriggerMatcher();
    const triggers = [newTrigger({ pattern: 'A', cooldownMs: 500 })];
    expect(m.push(ascii('A'), triggers, 1000)).toEqual([0]);
    expect(m.push(ascii('A'), triggers, 1400)).toEqual([]);
    expect(m.push(ascii('A'), triggers, 1500)).toEqual([0]);
  });

  it('ignores disabled triggers and unusable patterns', () => {
    const m = new TriggerMatcher();
    const triggers = [
      newTrigger({ pattern: 'A', enabled: false }),
      newTrigger({ match: 'HEX', pattern: 'ZZ' }),
      newTrigger({ match: 'REGEX', pattern: '(' }),
    ];
    expect(m.push(ascii('A ZZ (\n'), triggers, 0)).toEqual([]);
  });

  it('checks patterns before they are saved', () => {
    expect(triggerPatternError({ match: 'ASCII', pattern: 'OK' })).toBe('');
    expect(triggerPatternError({ match: 'ASCII', pattern: '  ' })).toBe('empty');
    expect(triggerPatternError({ match: 'HEX', pattern: 'GG' })).not.toBe('');
    expect(triggerPatternError({ match: 'REGEX', pattern: '([' })).not.toBe('');
  });
});

describe('scheduler', () => {
  it('runs a schedule immediately and then every interval', () => {
    const last = new Map<number, number>();
    const schedules = [newSchedule({ intervalS: 2, data: 'A' }), newSchedule({ enabled: false })];
    expect(dueSchedules(schedules, last, 0)).toEqual([0]);
    expect(dueSchedules(schedules, last, 1999)).toEqual([]);
    expect(dueSchedules(schedules, last, 2000)).toEqual([0]);
  });
});

describe('macro recording', () => {
  it('records sends with the pauses in between as steps', () => {
    const rec = new MacroRecorder();
    rec.start(1000);
    rec.record(ascii('AT\r\n'), 1500);
    rec.record(hex('01 02'), 1505);
    expect(rec.count).toBe(2);
    expect(rec.stop()).toEqual([
      expect.objectContaining({ kind: 'wait', value: 500 }),
      expect.objectContaining({ kind: 'send', data: '41 54 0D 0A', fmt: 'HEX', newline: 'None' }),
      expect.objectContaining({ kind: 'send', data: '01 02', fmt: 'HEX', newline: 'None' }),
    ]);
    expect(rec.stop()).toEqual([]);
  });

  it('records nothing before start', () => {
    const rec = new MacroRecorder();
    rec.record(ascii('A'), 0);
    expect(rec.stop()).toEqual([]);
  });
});

describe('stored triggers and schedules', () => {
  it('normalises damaged entries', () => {
    expect(normalizeTrigger({ match: 'X', cooldownMs: -5, enabled: 'no' })).toEqual(
      newTrigger({ cooldownMs: 0 }),
    );
    expect(normalizeSchedule({ interval: '0', fmt: 'HEX' })).toEqual(
      newSchedule({ intervalS: 1, fmt: 'HEX' }),
    );
    expect(normalizeList('x', normalizeTrigger)).toEqual([]);
    expect(normalizeList(new Array(500).fill({}), normalizeSchedule)).toHaveLength(200);
  });

  it('are part of the settings', () => {
    const s = normalizeSettings({
      triggers: [{ name: 'Ack', pattern: 'PING', response: 'PONG' }],
      schedules: [{ name: 'Poll', intervalS: 5, data: 'AT' }],
    });
    expect(s.triggers[0]).toMatchObject({ name: 'Ack', pattern: 'PING', response: 'PONG' });
    expect(s.schedules[0]).toMatchObject({ name: 'Poll', intervalS: 5, data: 'AT' });
    expect(normalizeSettings({}).triggers).toEqual([]);
  });
});
