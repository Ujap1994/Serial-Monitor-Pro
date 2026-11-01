// The long-run test program itself, briefly against the simulators: it has to
// pass on correct devices and must notice a broken one.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSoak, writeReport } from '../soak/runner';

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

  it('fails when a device does not answer as specified', async () => {
    // The plain loopback echoes the commands instead of answering them.
    const report = await runSoak(
      { lanes: [{ name: 'wrong', role: 'testdevice', path: 'sim:loopback' }] },
      0.05,
    );
    expect(report.verdict).toBe('FAIL');
    expect(report.lanes[0]?.failures.join()).toMatch(/device not found|no successful/);
  }, 30_000);

  it('refuses devices on the "never" list before opening anything', async () => {
    await expect(
      runSoak(
        { lanes: [{ name: 'x', role: 'loopback', serialNumber: 'BLOCKED1' }], never: ['BLOCKED1'] },
        0.01,
      ),
    ).rejects.toThrow(/must never be opened/);
  });
});
