// The long-run test program itself, briefly against the simulators: it has to
// pass on correct devices and must notice a broken one.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectedAfterLoss, restartedSince, runSoak, writeReport } from '../soak/runner';

describe('long-run test program', () => {
  it('passes against the simulated test device and loopback, with intended faults', async () => {
    const report = await runSoak(
      {
        lanes: [
          {
            name: 'td',
            role: 'testdevice',
            path: 'sim:testdevice',
            streamMs: 50,
            nmeaMs: 100,
            faultEvery: 3,
            gapMs: 5,
          },
          { name: 'lb', role: 'loopback', path: 'sim:loopback', gapMs: 5 },
        ],
      },
      0.12,
    );
    const [td, lb] = report.lanes;
    expect(td?.failures).toEqual([]);
    expect(lb?.failures).toEqual([]);
    expect(td?.stats.ok).toBeGreaterThan(20);
    expect(td?.stats.streamLines).toBeGreaterThan(20);
    expect(td?.stats.nmeaBad).toBeGreaterThan(0);
    expect(td?.stats.bursts).toBeGreaterThan(0);
    expect(td?.stats.lastDeviceStat?.frames).toBeGreaterThan(0);
    expect(lb?.stats.ok).toBeGreaterThan(20);
    expect(report.verdict).toBe('PASS');
    const dir = mkdtempSync(join(tmpdir(), 'smp-soak-'));
    expect(writeReport(report, dir)).toContain('✅ PASS');
    expect(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).verdict).toBe('PASS');
  }, 30_000);

  it('restarts the device unattended: firmware RESET, reopening and DTR/RTS resets', async () => {
    const lane = (name: string, lineReset: 'dtr' | 'rts') => ({
      name,
      role: 'testdevice' as const,
      path: 'sim:testdevice',
      gapMs: 5,
      streamMs: 100,
      lineReset,
      // Fractions of a minute: every few seconds in this short run.
      resetEveryMin: 0.05,
      reopenEveryMin: 0.07,
      lineResetEveryMin: 0.04,
    });
    for (const lineReset of ['dtr', 'rts'] as const) {
      const report = await runSoak({ lanes: [lane(lineReset, lineReset)] }, 0.2);
      const s = report.lanes[0]!.stats;
      expect(report.lanes[0]?.failures).toEqual([]);
      expect(s.resets).toBeGreaterThan(0);
      expect(s.reopens).toBeGreaterThan(0);
      expect(s.lineResets).toBeGreaterThan(0);
      expect(s.recoveryFailed).toBe(0);
      // Restarts the test asked for are no unplanned restarts.
      expect(s.unplanned).toBe(0);
      expect(s.ok).toBeGreaterThan(20);
    }
  }, 60_000);

  it('fails when a device does not answer as specified', async () => {
    // The plain loopback echoes the commands instead of answering them.
    const report = await runSoak(
      { lanes: [{ name: 'wrong', role: 'testdevice', path: 'sim:loopback' }] },
      0.05,
    );
    expect(report.verdict).toBe('FAIL');
    expect(report.lanes[0]?.failures.join()).toMatch(/device not found|no successful/);
  }, 30_000);

  it('sends nothing more to a "loopback" port whose probe does not come back', async () => {
    // A test device is no bridge: it answers the probe instead of echoing it.
    const report = await runSoak(
      { lanes: [{ name: 'no-bridge', role: 'loopback', path: 'sim:testdevice' }] },
      0.05,
    );
    const lane = report.lanes[0]!;
    expect(report.verdict).toBe('FAIL');
    expect(lane.failures.join()).toMatch(/no loopback/);
    expect(lane.stats.requests).toBe(0);
  }, 30_000);

  it('tells planned, expected and unplanned device restarts apart', () => {
    const last = { ms: 60_000, at: 1_000_000 };
    // 30 s later the uptime grew by 30 s: no restart.
    expect(restartedSince(last, 90_000, 1_030_000)).toBe(false);
    // 30 s later only 5 s of uptime: restarted in between.
    expect(restartedSince(last, 5_000, 1_030_000)).toBe(true);
    expect(restartedSince(null, 5_000, 1_030_000)).toBe(false);
    // Unplugged or switched off at the hub: the board starts from power.
    expect(expectedAfterLoss(true, 'power')).toBe(true);
    expect(expectedAfterLoss(true, undefined)).toBe(true);
    // A self-recovery (USB stall, watchdog) is reported even though the port vanished.
    expect(expectedAfterLoss(true, 'usb-stall')).toBe(false);
    expect(expectedAfterLoss(true, 'watchdog')).toBe(false);
    expect(expectedAfterLoss(false, undefined)).toBe(false);
  });

  it('refuses devices on the "never" list before opening anything', async () => {
    await expect(
      runSoak(
        { lanes: [{ name: 'x', role: 'loopback', serialNumber: 'BLOCKED1' }], never: ['BLOCKED1'] },
        0.01,
      ),
    ).rejects.toThrow(/must never be opened/);
  });
});
