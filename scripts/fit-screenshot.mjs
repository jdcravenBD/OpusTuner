/**
 * Trims or pads a screenshot to an exact App Store size.
 *
 * Chrome's device emulation will not hand you the sizes Apple asks for. Set it
 * to 414 x 896 at a device pixel ratio of 3 and the capture comes out
 * 1242 x 2687: one device pixel short, every time, because the emulated
 * viewport is not exactly 896 CSS pixels tall and the multiply is floored.
 * There is no DPR that fixes it. 896 x 3 is 2688 and the answer is 2687; a
 * fractional DPR does not help, and asking for 897 overshoots by three. App
 * Store Connect rejects the upload for that one row.
 *
 * So this fixes it afterwards. A row short is made up by repeating the last
 * row, which on a screenshot of a dark app is not detectable by eye and is not
 * a stretch of the image: every original pixel stays exactly where it was, at
 * its original size. Anything over is cropped from the bottom right for the
 * same reason.
 *
 *   node scripts/fit-screenshot.mjs shot.png          nearest accepted size
 *   node scripts/fit-screenshot.mjs shots/            every png in a folder
 *   node scripts/fit-screenshot.mjs shot.png 1242x2688
 *
 * Output goes beside the input as <name>.fitted.png, so the original is never
 * touched and a bad run costs nothing.
 *
 * The PNG codec lives in png.mjs. It used to live here, on the argument that a
 * shared module was a worse trade than forty lines that did not need one; that
 * held while this was the only decoder in the repo. The icon installer needs
 * exactly the same pair of operations, and a second copy of the scanline
 * filters is where they would have started to drift.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

/** What App Store Connect accepts for an iPhone screenshot. */
const ACCEPTED = [
  [1242, 2688],
  [2688, 1242],
  [1284, 2778],
  [2778, 1284],
];

/* -------------------------------------------------------------------- fit -- */

/**
 * Crop or edge-extend to exactly w x h.
 *
 * Never scales. A screenshot that has been resampled to fit looks softer than
 * the ones around it on a store page, and the whole reason for capturing at
 * device resolution is to avoid exactly that.
 */
function fit(src, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(y, src.height - 1);
    for (let x = 0; x < w; x++) {
      const sx = Math.min(x, src.width - 1);
      const s = (sy * src.width + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = src.rgba[s];
      out[d + 1] = src.rgba[s + 1];
      out[d + 2] = src.rgba[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

/** The accepted size needing the least change from what was captured. */
function nearest(width, height) {
  let best = ACCEPTED[0];
  let cost = Infinity;
  for (const [w, h] of ACCEPTED) {
    const c = Math.abs(w - width) + Math.abs(h - height);
    if (c < cost) {
      cost = c;
      best = [w, h];
    }
  }
  return best;
}

function fitFile(path, forced) {
  const src = decodePng(readFileSync(path));
  const [w, h] = forced ?? nearest(src.width, src.height);
  const out = join(dirname(path), `${basename(path, extname(path))}.fitted.png`);
  writeFileSync(out, encodePng(fit(src, w, h), w, h));
  const delta = `${src.width}x${src.height} -> ${w}x${h}`;
  const note = src.width === w && src.height === h ? 'already exact' : delta;
  console.log(`${basename(path)}  ${note}  ->  ${basename(out)}`);
}

/* ------------------------------------------------------------------- main -- */

const [target, size] = process.argv.slice(2);
if (!target) {
  console.error('usage: node scripts/fit-screenshot.mjs <file.png|folder> [1242x2688]');
  process.exit(1);
}

const forced = size ? size.split('x').map(Number) : null;
if (forced && (forced.length !== 2 || forced.some((n) => !Number.isInteger(n) || n <= 0))) {
  console.error(`bad size ${size}, expected something like 1242x2688`);
  process.exit(1);
}

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith('.png') && !f.endsWith('.fitted.png'))
      .map((f) => join(target, f))
  : [target];

if (files.length === 0) {
  console.error(`no PNGs in ${target}`);
  process.exit(1);
}

for (const f of files) fitFile(f, forced);
console.log(`\n${files.length} file${files.length === 1 ? '' : 's'} fitted.`);
