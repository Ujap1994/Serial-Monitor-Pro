#!/usr/bin/env node
// Writes the body of a GitHub release: a download table built from the files
// that were actually produced, followed by the matching CHANGELOG section.
//
//   node scripts/release-notes.mjs <version> [dist-dir] > release-notes.md

import { readdirSync, readFileSync } from 'node:fs';

const [version, dist = 'dist'] = process.argv.slice(2);
if (!version) {
  console.error('usage: release-notes.mjs <version> [dist-dir]');
  process.exit(1);
}

const repo = 'https://github.com/Ujap1994/Serial-Monitor-Pro';
const files = readdirSync(dist);

const ROWS = [
  ['**Windows** – installer', (f) => f.endsWith('-setup.exe')],
  ['**Windows** – portable', (f) => f.endsWith('-portable.exe')],
  ['**macOS**', (f) => f.endsWith('.dmg')],
  ['**Debian · Ubuntu · Mint · Pop!_OS**', (f) => f.endsWith('.deb')],
  ['**Fedora · RHEL · openSUSE**', (f) => f.endsWith('.rpm')],
  ['**Arch · Manjaro · EndeavourOS · CachyOS**', (f) => f.endsWith('.pacman')],
  ['**Flatpak** (all distributions)', (f) => f.endsWith('.flatpak')],
  ['**AppImage** (all distributions)', (f) => f.endsWith('.AppImage')],
  ['**tar.gz** (all distributions)', (f) => f.endsWith('.tar.gz')],
];

const arch = (f) =>
  /(arm64|aarch64)/.test(f) ? 'arm64' : /(x64|amd64|x86_64)/.test(f) ? 'x64' : '';
const link = (f) => (f ? `[\`${f}\`](${repo}/releases/download/v${version}/${f})` : '–');

const table = ROWS.map(([label, match]) => {
  const found = files.filter(match);
  return `| ${label} | ${link(found.find((f) => arch(f) === 'x64'))} | ${link(found.find((f) => arch(f) === 'arm64'))} |`;
}).filter((row) => !row.endsWith('| – | – |'));

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const section =
  changelog
    .split(/^## /m)
    .find((s) => s.startsWith(`[${version}]`))
    ?.split('\n')
    .slice(1)
    .join('\n')
    .trim() ?? '';

console.log(`## Downloads

| System | x64 (Intel / AMD) | arm64 (Apple Silicon / ARM) |
|---|---|---|
${table.join('\n')}

Installation instructions for every platform: [README → Installation](${repo}#-installation) ·
verify downloads with \`SHA256SUMS.txt\`.

> [!NOTE]
> The builds are not signed with a paid certificate. Windows SmartScreen and macOS Gatekeeper therefore
> show a warning on first start – the README explains how to open the app anyway.

${section ? `## Changes\n\n${section}\n` : ''}
---

Serial Monitor Pro is open-source software (MIT) and comes without any warranty or liability –
see [LICENSE](${repo}/blob/main/LICENSE) and the disclaimer in the README.`);
