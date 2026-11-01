#!/usr/bin/env node
// Starts the long-run test – asks for everything it needs.
//
//   npm run longrun
//   npm run longrun -- --minutes 480 --mode gui --devices --yes
//
// Options (all optional; whatever is missing is asked):
//   --minutes <n>               duration in minutes (per test)
//   --mode terminal|gui|both    terminal: serial stack without a window
//                               gui:      the real application, visible
//                               both:     first terminal, then gui
//   --devices | --simulator     the boards of hardware/devices.local.json, or the simulator
//   --yes                       start without the final question
//
// On macOS the computer is kept awake for the whole run (caffeinate).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const devicesFile = join(root, 'hardware', 'devices.local.json');
const reportsDir = join(root, 'soak-reports');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const german = /^de/i.test(
  process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale,
);
const T = german
  ? {
      title: 'Serial Monitor Pro – Langzeittest',
      minutes: 'Dauer in Minuten',
      mode: 'Was soll laufen?\n  1) Terminal – serielle Ebene ohne Fenster, alle Geräte parallel\n  2) GUI – die echte Anwendung sichtbar mit allen Geräten\n  3) Beides nacheinander (jeweils mit der Dauer)\nAuswahl',
      target:
        'Womit?\n  1) Mit den Test-Geräten (hardware/devices.local.json)\n  2) Mit dem Simulator\nAuswahl',
      noDevices: 'hardware/devices.local.json fehlt – es wird der Simulator verwendet.',
      checking: 'Prüfe die Test-Geräte …',
      missing: 'Nicht alle Geräte antworten. Trotzdem starten?',
      summary: (m, mode, target, total) =>
        `\nStart: ${mode} mit ${target}, ${m} min${total !== m ? ` (insgesamt ${total} min)` : ''}.`,
      start: 'Jetzt starten?',
      awake: 'Der Mac bleibt während des Tests wach (caffeinate).',
      cancel: 'Abgebrochen.',
      done: (ok) =>
        ok ? '\n✅ Langzeittest bestanden.' : '\n❌ Langzeittest mit Fehlern beendet.',
      report: 'Bericht',
      invalid: 'Bitte eine Zahl größer als 0 eingeben.',
      names: { terminal: 'Terminal-Test', gui: 'GUI-Test', both: 'Terminal- und GUI-Test' },
      targets: { devices: 'den Test-Geräten', simulator: 'dem Simulator' },
      yes: 'j',
    }
  : {
      title: 'Serial Monitor Pro – long-run test',
      minutes: 'Duration in minutes',
      mode: 'What should run?\n  1) Terminal – serial stack without a window, all devices in parallel\n  2) GUI – the real application, visible, with all devices\n  3) Both, one after the other (each for the duration)\nChoice',
      target:
        'With what?\n  1) The test devices (hardware/devices.local.json)\n  2) The simulator\nChoice',
      noDevices: 'hardware/devices.local.json is missing – using the simulator.',
      checking: 'Checking the test devices …',
      missing: 'Not every device answers. Start anyway?',
      summary: (m, mode, target, total) =>
        `\nStarting: ${mode} with ${target}, ${m} min${total !== m ? ` (${total} min in total)` : ''}.`,
      start: 'Start now?',
      awake: 'The Mac stays awake during the test (caffeinate).',
      cancel: 'Cancelled.',
      done: (ok) =>
        ok ? '\n✅ Long-run test passed.' : '\n❌ Long-run test finished with errors.',
      report: 'Report',
      invalid: 'Please enter a number greater than 0.',
      names: { terminal: 'terminal test', gui: 'GUI test', both: 'terminal and GUI test' },
      targets: { devices: 'the test devices', simulator: 'the simulator' },
      yes: 'y',
    };

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (question, fallback) => {
  const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
  return answer || String(fallback);
};
const confirm = async (question) => (await ask(question, T.yes)).toLowerCase().startsWith(T.yes);

console.log(`\n${T.title}\n${'─'.repeat(T.title.length)}\n`);

let minutes = Number(option('minutes'));
while (!(minutes > 0)) {
  minutes = Number((await ask(T.minutes, 60)).replace(',', '.'));
  if (!(minutes > 0)) console.log(T.invalid);
}

let mode = option('mode');
if (!['terminal', 'gui', 'both'].includes(mode)) {
  const choice = await ask(T.mode, 1);
  mode = choice === '2' ? 'gui' : choice === '3' ? 'both' : 'terminal';
}

let target = flag('simulator') ? 'simulator' : flag('devices') ? 'devices' : undefined;
if (!existsSync(devicesFile)) {
  if (target !== 'simulator') console.log(T.noDevices);
  target = 'simulator';
}
if (!target) target = (await ask(T.target, 1)) === '2' ? 'simulator' : 'devices';

if (target === 'devices') {
  console.log(`\n${T.checking}`);
  const check = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'firmware.mjs'), 'check', 'all'],
    {
      encoding: 'utf8',
    },
  );
  const output = `${check.stdout}${check.stderr}`;
  process.stdout.write(output);
  if (/✗/.test(output) && !flag('yes') && !(await confirm(T.missing))) {
    console.log(T.cancel);
    process.exit(1);
  }
}

const total = mode === 'both' ? minutes * 2 : minutes;
console.log(T.summary(minutes, T.names[mode], T.targets[target], total));
if (!flag('yes') && !(await confirm(T.start))) {
  console.log(T.cancel);
  process.exit(1);
}
rl.close();

const env = {
  ...process.env,
  SMP_SOAK_MINUTES: String(minutes),
  ...(target === 'devices' ? { SMP_SOAK_DEVICES: '1' } : {}),
};

/** Runs an npm script; on macOS wrapped in caffeinate so the computer does not sleep. */
function run(script) {
  const command = process.platform === 'darwin' ? 'caffeinate' : npm;
  const commandArgs =
    process.platform === 'darwin' ? ['-dims', npm, 'run', script] : ['run', script];
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
  });
}

if (process.platform === 'darwin') console.log(T.awake);
const before = new Date();
const results = [];
if (mode === 'terminal' || mode === 'both') results.push(await run('soak'));
if (mode === 'gui' || mode === 'both') results.push(await run('soak:gui'));

const reports = existsSync(reportsDir)
  ? readdirSync(reportsDir)
      .map((name) => join(reportsDir, name))
      .filter((dir) => statSync(dir).mtime >= before)
  : [];
const ok = results.every(Boolean);
console.log(T.done(ok));
for (const dir of reports) {
  const file = join(dir, 'report.md');
  if (existsSync(file)) {
    console.log(`${T.report}: ${file}`);
    console.log(readFileSync(file, 'utf8').split('\n').slice(0, 12).join('\n'));
  }
}
process.exit(ok ? 0 : 1);
