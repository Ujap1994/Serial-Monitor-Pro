#!/usr/bin/env node
// Complete quality check – run it before every commit or pull request:
//
//   npm run check            format, lint, types, unit tests, build, end-to-end tests
//   npm run check:quick      everything except build and end-to-end tests (fast)
//   npm run check -- --fix   format and auto-fix lint findings first
//
// The end-to-end tests start the real application with simulated devices, so
// no hardware is needed. On Linux without a display they run under xvfb-run.

import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
const fix = args.has('--fix');
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = color('32');
const red = color('31');
const dim = color('2');
const bold = color('1');

function hasCommand(cmd) {
  return spawnSync(isWin ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
}

/** On Linux without a display the Electron tests need a virtual X server. */
function e2eCommand() {
  const base = [npx, 'playwright', 'test'];
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    if (hasCommand('xvfb-run')) return ['xvfb-run', '-a', ...base];
    console.warn(red('No display found and xvfb-run is missing – install the "xvfb" package.'));
  }
  return base;
}

const steps = [
  ...(fix
    ? [
        { name: 'Format (write)', cmd: [npx, 'prettier', '--write', '.'] },
        { name: 'Lint (fix)', cmd: [npx, 'eslint', '--fix', '.'] },
      ]
    : []),
  { name: 'Format', cmd: [npx, 'prettier', '--check', '.'] },
  { name: 'Lint', cmd: [npx, 'eslint', '--max-warnings=0', '.'] },
  { name: 'Types (main)', cmd: [npx, 'tsc', '-p', 'tsconfig.node.json', '--noEmit'] },
  { name: 'Types (renderer)', cmd: [npx, 'tsc', '-p', 'tsconfig.web.json', '--noEmit'] },
  { name: 'Types (tests)', cmd: [npx, 'tsc', '-p', 'tsconfig.test.json', '--noEmit'] },
  {
    name: 'Unit tests',
    cmd: [npx, 'vitest', 'run', '--coverage', '--coverage.reporter=text-summary'],
  },
  ...(quick
    ? []
    : [
        { name: 'Build', cmd: [npx, 'electron-vite', 'build'] },
        { name: 'End-to-end tests', cmd: e2eCommand(), needs: 'Build' },
      ]),
];

const results = [];
for (const step of steps) {
  if (step.needs && results.find((r) => r.name === step.needs && !r.ok)) {
    results.push({ name: step.name, ok: false, skipped: true, ms: 0 });
    continue;
  }
  console.log(`\n${bold(`▶ ${step.name}`)} ${dim(step.cmd.join(' '))}`);
  const start = performance.now();
  const run = spawnSync(step.cmd[0], step.cmd.slice(1), { stdio: 'inherit', shell: isWin });
  results.push({ name: step.name, ok: run.status === 0, ms: performance.now() - start });
}

console.log(`\n${bold('Summary')}`);
for (const r of results) {
  const mark = r.skipped ? dim('–') : r.ok ? green('✓') : red('✗');
  const time = r.skipped ? dim('skipped') : dim(`${(r.ms / 1000).toFixed(1)} s`);
  console.log(`  ${mark} ${r.name.padEnd(20)} ${time}`);
}
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n${red(bold(`${failed.length} step(s) failed.`))}`);
  process.exit(1);
}
console.log(`\n${green(bold('All checks passed.'))}`);
