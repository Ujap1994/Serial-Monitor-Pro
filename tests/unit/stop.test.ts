import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import { checkStop, newStopState, type StopCondition } from '@shared/core/stop';
import { ascii, bytes } from './helpers';

beforeAll(() => setLanguage('de'));

const cond = (patch: Partial<StopCondition>): StopCondition => ({
  mode: 'pattern',
  pattern: '',
  patternFmt: 'ASCII',
  limit: 1000,
  disconnect: false,
  ...patch,
});

describe('checkStop', () => {
  it('finds a pattern across a packet border', () => {
    const c = cond({ pattern: 'ERROR' });
    const s = newStopState();
    expect(checkStop(c, s, ascii('data ER')).hit).toBe(false);
    const second = checkStop(c, s, ascii('ROR here'));
    expect(second.hit).toBe(true);
    expect(second.reason).toContain('ERROR');
  });

  it('finds hex patterns', () => {
    const c = cond({ pattern: 'FF 00', patternFmt: 'HEX' });
    expect(checkStop(c, newStopState(), bytes(0x01, 0xff, 0x00, 0x02)).hit).toBe(true);
  });

  it.each<[StopCondition['mode'], number, string[], boolean]>([
    ['bytes', 10, ['12345', '67890'], true],
    ['bytes', 100, ['kurz'], false],
    ['lines', 2, ['a\nb\n'], true],
    ['lines', 5, ['a\n'], false],
    ['seconds', 9999, ['x'], false],
  ])('%s with limit %i', (mode, limit, packets, expected) => {
    const c = cond({ mode, limit });
    const s = newStopState();
    let hit = false;
    for (const p of packets) hit = checkStop(c, s, ascii(p)).hit;
    expect(hit).toBe(expected);
  });

  it('fires the time limit even without data (periodic check)', () => {
    const c = cond({ mode: 'seconds', limit: 5 });
    const s = newStopState(1000);
    expect(checkStop(c, s, new Uint8Array(), 4000).hit).toBe(false);
    const result = checkStop(c, s, new Uint8Array(), 6100);
    expect(result.hit).toBe(true);
    expect(result.reason).toBe('5 Sekunden vergangen');
  });

  it('does not trigger on an empty pattern', () => {
    expect(checkStop(cond({ pattern: '' }), newStopState(), ascii('anything')).hit).toBe(false);
  });

  it('does not trigger on an invalid hex pattern', () => {
    expect(
      checkStop(cond({ pattern: 'ZZ', patternFmt: 'HEX' }), newStopState(), ascii('ZZ')).hit,
    ).toBe(false);
  });
});
