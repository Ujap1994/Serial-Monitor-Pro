// Long-run test entry point.
//
//   npm run soak                                    simulators, 2 minutes
//   SMP_SOAK_MINUTES=480 npm run soak               simulators, 8 hours
//   SMP_SOAK_DEVICES=1 SMP_SOAK_MINUTES=60 npm run soak
//                                                   the devices of hardware/devices.local.json
//
// The report is written to soak-reports/<date-time>/ (report.md, report.json, memory.csv).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runSoak, writeReport, type LaneConfig, type SoakConfig } from './runner';

const root = join(import.meta.dirname, '..', '..');
const minutes = Number(process.env.SMP_SOAK_MINUTES ?? 2);

function config(): SoakConfig {
  if (!process.env.SMP_SOAK_DEVICES) {
    return {
      lanes: [
        { name: 'sim-testdevice', role: 'testdevice', path: 'sim:testdevice', faultEvery: 7 },
        { name: 'sim-loopback', role: 'loopback', path: 'sim:loopback' },
      ],
    };
  }
  const file = join(root, 'hardware', 'devices.local.json');
  if (!existsSync(file)) throw new Error(`${file} is missing – see hardware/README.md`);
  const local = JSON.parse(readFileSync(file, 'utf8')) as {
    devices: (LaneConfig & { fqbn?: string })[];
    never?: string[];
  };
  return {
    lanes: local.devices.map(({ fqbn: _, ...lane }) => lane),
    never: local.never,
  };
}

it(`long-run test (${minutes} min)`, async () => {
  const report = await runSoak(config(), minutes, (lane, text) =>
    console.info(`[${new Date().toISOString().slice(11, 19)}] ${lane}: ${text}`),
  );
  const stamp = report.started.replace(/[:]/g, '-').slice(0, 19);
  const dir = join(root, 'soak-reports', stamp);
  console.info(writeReport(report, dir));
  console.info(`\nReport: ${dir}`);
  expect(report.verdict).toBe('PASS');
});
