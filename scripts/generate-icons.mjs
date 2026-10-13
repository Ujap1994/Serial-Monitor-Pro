#!/usr/bin/env node
// Renders every platform icon from the vector master in assets/brand/logo.svg.
//
//   npm run icons
//
// Each size is rendered directly from the SVG (no down-scaling of a large
// bitmap), so even the 16 px variants stay crisp. ICO and ICNS containers are
// assembled here from those PNGs - both formats accept embedded PNG data.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'assets', 'brand');
const out = join(root, 'build');
const svg = readFileSync(join(brand, 'logo.svg'), 'utf8');

/** Renders an SVG string to a square PNG of the given edge length. */
function render(source, size) {
  return new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

/**
 * macOS expects the icon body to occupy 824 of 1024 px (Big Sur grid). The
 * master tile spans 896 px, so it is scaled down and re-centred for the ICNS.
 */
function macVariant(source) {
  const scale = 824 / 896;
  const offset = 100 - 64 * scale;
  const open = source.indexOf('>', source.indexOf('<svg')) + 1;
  const close = source.lastIndexOf('</svg>');
  return (
    source.slice(0, open) +
    `<g transform="translate(${offset.toFixed(3)} ${offset.toFixed(3)}) scale(${scale.toFixed(5)})">` +
    source.slice(open, close) +
    '</g>' +
    source.slice(close)
  );
}

/** ICO with one PNG entry per size (supported since Windows Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

/** ICNS with PNG payloads for all standard and Retina slots. */
function buildIcns(source) {
  const slots = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ];
  const chunks = slots.map(([type, size]) => {
    const png = render(source, size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

function write(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`  ✓ ${file.replace(root + '/', '').replaceAll('\\', '/')}`);
}

console.log('Generating icons from assets/brand/logo.svg');

// Linux: one PNG per size (electron-builder picks them up from build/icons).
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  write(join(out, 'icons', `${size}x${size}.png`), render(svg, size));
}

// Generic master + runtime window icon.
write(join(out, 'icon.png'), render(svg, 1024));
write(join(root, 'resources', 'icon.png'), render(svg, 512));

// Windows.
write(
  join(out, 'icon.ico'),
  buildIco(
    [16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({ size, png: render(svg, size) })),
  ),
);

// macOS.
write(join(out, 'icon.icns'), buildIcns(macVariant(svg)));

// GitHub social preview (Settings → General → Social preview).
const banner = readFileSync(join(brand, 'social-preview.svg'), 'utf8');
write(
  join(brand, 'social-preview.png'),
  new Resvg(banner, {
    fitTo: { mode: 'width', value: 1280 },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  })
    .render()
    .asPng(),
);

console.log('Done.');
