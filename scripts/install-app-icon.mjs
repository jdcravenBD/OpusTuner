/**
 * Puts a downloaded icon into the iOS app: the app icon and the launch screen.
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
 *
 * **The launch screen is a different image and comes from here too.** It used
 * to carry the EAT lettermark from generate-icons.mjs, which is why installing
 * a new app icon still opened the app on the old mark: they are two assets and
 * only one of them had changed. Note that `npm run icons` still rewrites the
 * lettermark version — see the warning at the top of that script.
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

const SPLASH_DIR = join(REPO, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset');
/** Every variant in the imageset gets the same picture, as it did before. */
const SPLASH_FILES = [
  'splash-2732x2732.png',
  'splash-2732x2732-1.png',
  'splash-2732x2732-2.png',
];
const SPLASH = 2732;
/**
 * How large the icon is drawn on the launch screen, in source pixels.
 *
 * The storyboard shows this square with `scaleAspectFill` in a portrait screen,
 * so the whole 2732 is scaled by the screen's height over 2732 and cropped at
 * the sides. On every current iPhone that lands at about 0.93, which puts 560
 * here at 44% of the screen's width — a shade larger than the lettermark it
 * replaces, and rightly so, because a tile carries more weight than three thin
 * letters. Dropped in at its native 1024 the icon would cover 81% of the
 * screen, which is not a launch screen, it is a jump scare.
 */
const MARK = 560;
/** The app's own background, matching capacitor.config.json. */
const SPLASH_BG = [0x07, 0x08, 0x0a];
/** Exponent of the superellipse iOS masks icons with. Matches src/icon.ts. */
const MASK_N = 5;

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

/* --------------------------------------------------------------- splash -- */

/**
 * Area-averaged downscale.
 *
 * Every destination pixel is the mean of the source pixels it covers, which for
 * a reduction of this size is both the cheapest correct answer and a better one
 * than sampling: dropping pixels would alias the gridlines and the frame into a
 * shimmer.
 */
function downscale(source, from, to) {
  const out = Buffer.alloc(to * to * 4);
  const ratio = from / to;
  for (let y = 0; y < to; y++) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.min(from, Math.ceil((y + 1) * ratio));
    for (let x = 0; x < to; x++) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.min(from, Math.ceil((x + 1) * ratio));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * from + sx) * 4;
          r += source[i];
          g += source[i + 1];
          b += source[i + 2];
          n++;
        }
      }
      const d = (y * to + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = 255;
    }
  }
  return out;
}

/**
 * How much of pixel (x, y) falls inside the superellipse, 0 to 1.
 *
 * iOS applies this mask to the app icon and nothing applies it here, so the
 * launch screen has to carry it or the app opens on a square tile having been
 * launched from a rounded one. Supersampled, because a flat inside/outside test
 * leaves a visibly stepped edge at this size.
 */
function coverage(x, y, size) {
  const SUB = 4;
  let hit = 0;
  for (let sy = 0; sy < SUB; sy++) {
    for (let sx = 0; sx < SUB; sx++) {
      const u = (2 * (x + (sx + 0.5) / SUB)) / size - 1;
      const v = (2 * (y + (sy + 0.5) / SUB)) / size - 1;
      if (Math.abs(u) ** MASK_N + Math.abs(v) ** MASK_N <= 1) hit++;
    }
  }
  return hit / (SUB * SUB);
}

if (!existsSync(SPLASH_DIR)) {
  console.error(`no splash imageset at ${SPLASH_DIR}`);
  process.exit(1);
}

const mark = downscale(rgba, SIZE, MARK);
const canvas = Buffer.alloc(SPLASH * SPLASH * 4);
for (let i = 0; i < SPLASH * SPLASH; i++) {
  canvas[i * 4] = SPLASH_BG[0];
  canvas[i * 4 + 1] = SPLASH_BG[1];
  canvas[i * 4 + 2] = SPLASH_BG[2];
  canvas[i * 4 + 3] = 255;
}

const origin = Math.round((SPLASH - MARK) / 2);
for (let y = 0; y < MARK; y++) {
  for (let x = 0; x < MARK; x++) {
    const a = coverage(x, y, MARK);
    if (a <= 0) continue;
    const s = (y * MARK + x) * 4;
    const d = ((origin + y) * SPLASH + origin + x) * 4;
    for (let c = 0; c < 3; c++) {
      canvas[d + c] = Math.round(mark[s + c] * a + canvas[d + c] * (1 - a));
    }
  }
}

const splash = encodePng(canvas, SPLASH, SPLASH);
for (const name of SPLASH_FILES) writeFileSync(join(SPLASH_DIR, name), splash);
console.log(`launch screen ${SPLASH}x${SPLASH}, icon at ${MARK}px, corners masked`);
console.log(`wrote ${SPLASH_FILES.length} files in ios/.../Splash.imageset`);

console.log('\ncommit it, push, and the next Codemagic build carries both.');
