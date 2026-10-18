import { describe, expect, it } from 'vitest';
import { ResponseWatcher } from '@shared/core/steps';
import { ascii } from './helpers';

describe('ResponseWatcher (automation "expect response")', () => {
  it('finds an answer that arrived before the expect step started', () => {
    // A device answering within a few milliseconds beats the next step.
    const w = new ResponseWatcher();
    w.sent();
    w.push(ascii('OK\r\n'));
    expect(w.expect(ascii('OK'))).toBe(true);
    expect(w.waiting).toBe(false);
  });

  it('waits for an answer that arrives later, also across chunks', () => {
    const w = new ResponseWatcher();
    w.sent();
    expect(w.expect(ascii('READY'))).toBe(false);
    expect(w.waiting).toBe(true);
    expect(w.push(ascii('REA'))).toBe(false);
    expect(w.push(ascii('DY\r\n'))).toBe(true);
    expect(w.waiting).toBe(false);
  });

  it('ignores data received before the request went out', () => {
    const w = new ResponseWatcher();
    w.push(ascii('OK\r\n'));
    w.sent();
    expect(w.expect(ascii('OK'))).toBe(false);
  });

  it('lets the next expect step see what followed the previous match', () => {
    const w = new ResponseWatcher();
    w.sent();
    w.push(ascii('Sensor 1.0\r\nOK\r\n'));
    expect(w.expect(ascii('Sensor'))).toBe(true);
    expect(w.expect(ascii('OK'))).toBe(true);
    // The same OK cannot be consumed twice.
    expect(w.expect(ascii('OK'))).toBe(false);
  });

  it('forgets everything on reset', () => {
    const w = new ResponseWatcher();
    w.sent();
    w.push(ascii('OK'));
    w.expect(ascii('X'));
    w.reset();
    expect(w.waiting).toBe(false);
    expect(w.expect(ascii('OK'))).toBe(false);
  });

  it('keeps memory bounded on a chatty device', () => {
    const w = new ResponseWatcher();
    w.sent();
    for (let i = 0; i < 100; i++) w.push(new Uint8Array(4096));
    w.push(ascii('END'));
    expect(w.expect(ascii('END'))).toBe(true);
  });
});
