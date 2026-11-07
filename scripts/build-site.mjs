#!/usr/bin/env node
// Builds the project website (GitHub Pages) into dist/site: the files in site/
// plus the pictures they reference from docs/images and assets/brand, so the
// website always shows the current screenshots without keeping copies of them.
// A referenced picture that does not exist fails the build.
//
//   node scripts/build-site.mjs           build
//   node scripts/build-site.mjs --serve   build and serve on http://localhost:4173

import { createReadStream } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'site');
const target = path.join(root, 'dist', 'site');
const SITE_URL = 'https://ujap1994.github.io/Serial-Monitor-Pro/';

// Folders of the published site that are taken from elsewhere in the repository.
const MOUNTS = { 'images/': 'docs/images/', 'brand/': 'assets/brand/' };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

/** Every quoted path or url() in the site's own files that points into a mount. */
async function referencedFiles() {
  const found = new Set();
  for (const name of await readdir(source)) {
    if (!/\.(html|css|js)$/.test(name)) continue;
    const text = await readFile(path.join(source, name), 'utf8');
    for (const match of text.matchAll(/["'(]([^"'()\s]+\.(?:png|svg|jpg|webp))["')]/g)) {
      const ref = match[1].startsWith(SITE_URL) ? match[1].slice(SITE_URL.length) : match[1];
      if (Object.keys(MOUNTS).some((mount) => ref.startsWith(mount))) found.add(ref);
    }
  }
  return [...found].sort();
}

async function build() {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });

  const missing = [];
  const refs = await referencedFiles();
  for (const ref of refs) {
    const mount = Object.keys(MOUNTS).find((prefix) => ref.startsWith(prefix));
    const from = path.join(root, MOUNTS[mount], ref.slice(mount.length));
    try {
      await stat(from);
    } catch {
      missing.push(`${ref} (expected at ${path.relative(root, from)})`);
      continue;
    }
    const to = path.join(target, ref);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
  if (missing.length) {
    console.error(`Missing files referenced by the website:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.info(`Website built in ${path.relative(root, target)} (${refs.length} pictures).`);
}

function serve(port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let file = path.join(target, decodeURIComponent(url.pathname));
    if (file !== target && !file.startsWith(target + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    stat(file)
      .then((info) => {
        if (!info.isFile()) throw new Error('not a file');
        response.writeHead(200, {
          'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        });
        createReadStream(file).pipe(response);
      })
      .catch(() => response.writeHead(404).end('Not found'));
  });
  server.listen(port, () => console.info(`Serving the website on http://localhost:${port}/`));
}

await build();
if (process.argv.includes('--serve')) serve(Number(process.env.PORT ?? 4173));
