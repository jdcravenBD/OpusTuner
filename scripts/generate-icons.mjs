/**
 * Generates the PWA icon set.
 *
 * Rasterises the OpusTuner mark by hand and encodes PNGs with nothing but
 * Node's built-in zlib — no native canvas, no image dependency, so `npm run
 * icons` works on a clean checkout on any platform.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ------------------------------------------------------------------ paint -- */

/**
 * Signal green on black.
 *
 * The chassis gradient the icon used to carry has gone flat: on an OLED a
 * true black icon has no edges of its own, so the letters sit on the home
 * screen rather than on a tile placed there. The green is the app's, the
 * same one that means in tune.
 */
const GREEN = [0x34, 0xe0, 0x8a];
const BG_TOP = [0x00, 0x00, 0x00];
const BG_BOTTOM = [0x00, 0x00, 0x00];

/** Squared distance from (px,py) to the segment (ax,ay)-(bx,by). */
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function insideRoundedRect(x, y, r) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** Stroke weight, as a fraction of the content box. */
const STROKE_W = 0.085;

/**
 * EAT, as stroke segments in a normalised 0..1 content box.
 *
 * Drawn rather than set in a typeface, and the three letters are why it is
 * possible: E, A and T are the whole alphabet's easiest, every one of them
 * straight lines. So this file still has no font to load and no rasteriser to
 * depend on — it is arithmetic and zlib, and it runs on a clean checkout of
 * any platform.
 *
 * The segments are the single source for both the rasteriser below and the
 * SVG further down, so the favicon cannot drift away from the app icon.
 */
const STROKES = (() => {
  const W = STROKE_W;
  const LW = 0.28; // letter width
  const GAP = 0.08; // between letters; 3 * LW + 2 * GAP is exactly 1

  // Ends inset by half the stroke: distToSegment draws a capsule, so a
  // segment run edge to edge would round out past the box it is measured in.
  const top = 0.24 + W / 2;
  const bot = 0.76 - W / 2;
  const mid = (top + bot) / 2;

  const e = 0;
  const a = LW + GAP;
  const tee = 2 * (LW + GAP);
  const apex = a + LW / 2;

  // Where the A's crossbar meets its legs.
  //
  // Low. At two thirds the counter above it was a sliver -- the strokes are
  // nearly a third of a letter's width, so a bar set where a text face would
  // put it leaves a hole that closes up entirely by 29 px and turns the A into
  // a solid triangle.
  const f = 0.74;
  const inset = (LW / 2 - W / 2) * f;
  const barY = top + (bot - top) * f;

  return [
    /* E */
    [e + W / 2, top, e + W / 2, bot],
    [e + W / 2, top, e + LW - W / 2, top],
    [e + W / 2, mid, e + LW - W * 0.9, mid],
    [e + W / 2, bot, e + LW - W / 2, bot],
    /* A */
    [a + W / 2, bot, apex, top],
    [a + LW - W / 2, bot, apex, top],
    [apex - inset, barY, apex + inset, barY],
    /* T */
    [tee + W / 2, top, tee + LW - W / 2, top],
    [tee + LW / 2, top, tee + LW / 2, bot],
  ];
})();

function markAlpha(x, y) {
  for (const [ax, ay, bx, by] of STROKES) {
    if (distToSegment(x, y, ax, ay, bx, by) <= STROKE_W / 2) return 1;
  }
  return 0;
}

/**
 * @param {number} size        pixel dimensions
 * @param {number} corner      corner radius as a fraction of the size (0 = square)
 * @param {number} contentScale mark size relative to the icon box
 * @param {number[]|null} flat  solid background instead of the gradient
 */
function render(size, corner, contentScale, flat = null) {
  // Supersampling is quadratic in cost and the launch image is 2732 square,
  // which at 4x is a hundred and twenty million samples. The big ones are
  // almost entirely flat field, so they lose nothing at 2x.
  const SS = size > 1024 ? 2 : 4;
  const data = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (px + (sx + 0.5) / SS) / size;
          const ny = (py + (sy + 0.5) / SS) / size;

          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sa = 0;

          if (corner === 0 || insideRoundedRect(nx, ny, corner)) {
            const t = ny;
            sr = flat ? flat[0] : BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
            sg = flat ? flat[1] : BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
            sb = flat ? flat[2] : BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;
            sa = 1;
          }

          const ux = (nx - 0.5) / contentScale + 0.5;
          const uy = (ny - 0.5) / contentScale + 0.5;
          const alpha = markAlpha(ux, uy);
          if (alpha > 0) {
            sr = GREEN[0] * alpha + sr * (1 - alpha);
            sg = GREEN[1] * alpha + sg * (1 - alpha);
            sb = GREEN[2] * alpha + sb * (1 - alpha);
            sa = Math.max(sa, alpha);
          }

          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }

      const n = SS * SS;
      const i = (py * size + px) * 4;
      data[i] = Math.round(r / n);
      data[i + 1] = Math.round(g / n);
      data[i + 2] = Math.round(b / n);
      data[i + 3] = Math.round((a / n) * 255);
    }
  }

  return data;
}

/* -------------------------------------------------------------- png codec -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0);
  return Buffer.concat([length, typeBuf, body, crc]);
}

/**
 * `opaque` drops the alpha channel entirely rather than filling it.
 *
 * Not a size optimisation. Xcode refuses an app icon that carries an alpha
 * channel at all, and it refuses it at *validation* time — after the upload,
 * by email, having wasted the build. A fully opaque alpha channel is still an
 * alpha channel, so the only safe answer is colour type 2.
 */
function encodePng(rgba, size, opaque = false) {
  const channels = opaque ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const stride = size * channels;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    if (opaque) {
      for (let x = 0; x < size; x++) {
        const src = (y * size + x) * 4;
        const dst = row + 1 + x * 3;
        raw[dst] = rgba[src];
        raw[dst + 1] = rgba[src + 1];
        raw[dst + 2] = rgba[src + 2];
      }
    } else {
      rgba.copy(raw, row + 1, y * stride, (y + 1) * stride);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ build -- */

/*
 * The favicon, written from the very same segments so it cannot drift.
 *
 * 0.78 matches the scale the 512 icon is drawn at, and 96 is the viewBox, so
 * a stroke here is the same fraction of the square that it is in the PNGs.
 */
const SVG_SCALE = 0.78;
const svgPos = (v) => (48 + (v - 0.5) * 96 * SVG_SCALE).toFixed(2);
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
  <rect width="96" height="96" rx="21" fill="#000000"/>
  <g stroke="#34E08A" fill="none" stroke-linecap="round" stroke-width="${(
    STROKE_W * 96 * SVG_SCALE
  ).toFixed(2)}">
${STROKES.map(
  ([ax, ay, bx, by]) =>
    `    <path d="M${svgPos(ax)} ${svgPos(ay)}L${svgPos(bx)} ${svgPos(by)}"/>`,
).join('\n')}
  </g>
</svg>
`;

const TARGETS = [
  { file: 'icon-16.png', size: 16, corner: 0.16, scale: 0.86 },
  { file: 'icon-32.png', size: 32, corner: 0.16, scale: 0.86 },
  { file: 'icon-192.png', size: 192, corner: 0.22, scale: 0.78 },
  { file: 'icon-512.png', size: 512, corner: 0.22, scale: 0.78 },
  // Maskable: full bleed, mark kept inside the 80% safe zone launchers crop to.
  { file: 'icon-maskable-512.png', size: 512, corner: 0, scale: 0.6 },
  // iOS applies its own mask, so ship a full square.
  { file: 'apple-touch-icon.png', size: 180, corner: 0, scale: 0.74 },
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon.svg'), SVG, 'utf8');
console.log('icon.svg');

for (const { file, size, corner, scale } of TARGETS) {
  const png = encodePng(render(size, corner, scale), size);
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log(`\nWrote ${TARGETS.length + 1} files to public/icons/`);

/* -------------------------------------------------------------------- ios -- */

/*
 * The two images the Xcode project ships with are Capacitor's own logo, and
 * they are what an untouched build puts on the home screen and on the launch
 * screen. Overwriting them here keeps the mark in one place: change the paths
 * in markAlpha above and the web icons, the app icon and the launch image all
 * follow.
 *
 * Both are square and full-bleed. iOS applies its own corner mask to the
 * icon, and the launch image is scaled to fill a screen of unknown shape, so
 * a rounded rectangle in either one would be a rounded rectangle drawn twice.
 */
const IOS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ios', 'App', 'App',
  'Assets.xcassets');

if (existsSync(IOS_DIR)) {
  const appIcon = join(IOS_DIR, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  writeFileSync(appIcon, encodePng(render(1024, 0, 0.72), 1024, true));
  console.log('ios AppIcon-512@2x.png  1024x1024  no alpha');

  // One drawing under three names: the plugin looks for @1x/@2x/@3x and the
  // image is far larger than any of them needs.
  const splash = encodePng(render(2732, 0, 0.185, [0x07, 0x08, 0x0a]), 2732, true);
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png',
                      'splash-2732x2732-2.png']) {
    writeFileSync(join(IOS_DIR, 'Splash.imageset', name), splash);
  }
  console.log('ios Splash 2732x2732 x3');
} else {
  console.log('\nno ios/ project — skipped the app icon and launch image');
}
