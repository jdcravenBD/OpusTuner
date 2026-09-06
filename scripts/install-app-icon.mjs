/**
 * Puts a downloaded icon into the iOS app, with the alpha channel taken off.
 *
 *   npm run icon:app -- ~/Downloads/easyastuning-icon-1024.png
 *
 * The icon is designed in the browser (`npm run dev`, then `?icon`) because
 * that is where the app's own colours and the app's own nib already live. A
 * canvas can only hand back RGBA, though, and that one detail is worth a whole
 * script: **App Store Connect rejects an app icon that carries an alpha
 * channel.** ITMS-90717, raised after the upload has finished, which on a
 * hosted Mac is eight minutes and a build gone. The corners are opaque and the
 * icon looks perfectly fine — it is the presence of the channel that is
 * refused, not what is in it.
 *
 * So this decodes the PNG, composites anything transparent onto black, and
 * re-encodes as truecolour with no alpha at all. It also refuses a file that
 * is not exactly 1024 x 1024, because Xcode will accept the wrong size into
 * the asset catalog and fail much later.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(
  REPO,
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset',
  'AppIcon-512@2x.png',
);
const SIZE = 1024;

const src = process.argv[2];
if (!src) {
  console.error('usage: npm run icon:app -- <path to the 1024x1024 png>');
  console.error('generate one with `npm run dev` and http://localhost:5440/?icon');
  process.exit(1);
}

const path = resolve(src);
if (!existsSync(path)) {
  console.error(`no such file: ${path}`);
  process.exit(1);
}

const { width, height, rgba } = decodePng(readFileSync(path));

if (width !== SIZE || height !== SIZE) {
  console.error(`icon must be exactly ${SIZE}x${SIZE}, this one is ${width}x${height}.`);
  console.error('the ?icon page always produces the right size — re-download rather than resizing.');
  process.exit(1);
}

/*
 * Composite onto black rather than merely dropping the channel.
 *
 * Dropping it would keep whatever colour happened to sit under a transparent
 * pixel, which for a canvas is usually black anyway but is not guaranteed —
 * a partially transparent glow would come out at full strength. Compositing
 * gives the same picture the browser showed.
 */
let translucent = 0;
for (let i = 0; i < SIZE * SIZE; i++) {
  const a = rgba[i * 4 + 3];
  if (a === 255) continue;
  translucent++;
  const k = a / 255;
  rgba[i * 4] = Math.round(rgba[i * 4] * k);
  rgba[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * k);
  rgba[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * k);
  rgba[i * 4 + 3] = 255;
}

if (!existsSync(dirname(DEST))) {
  console.error(`no asset catalog at ${dirname(DEST)}`);
  process.exit(1);
}

writeFileSync(DEST, encodePng(rgba, SIZE, SIZE));

const rel = DEST.slice(REPO.length + 1).replace(/\\/g, '/');
console.log(`${SIZE}x${SIZE}, alpha removed${translucent ? ` (${translucent} translucent pixels composited)` : ''}`);
console.log(`wrote ${rel}`);
console.log('\ncommit it, push, and the next Codemagic build carries the new icon.');
