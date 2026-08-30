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
 * The PNG codec here is its own. generate-icons.mjs has an encoder, but it has
 * no decoder and never needs one, and threading a shared module through a
 * script that works is a worse trade than forty lines that do not.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';

/** What App Store Connect accepts for an iPhone screenshot. */
const ACCEPTED = [
  [1242, 2688],
  [2688, 1242],
  [1284, 2778],
  [2778, 1284],
];

/* ------------------------------------------------------------------ decode -- */

function readChunks(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) throw new Error('not a PNG');
  }
  const chunks = [];
  let at = 8;
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    chunks.push({ type, body: buf.subarray(at + 8, at + 8 + length) });
    at += 12 + length; // length + type + body + crc
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Returns { width, height, rgba } with rgba as 4 bytes per pixel. */
function decodePng(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('no IHDR');

  const width = ihdr.body.readUInt32BE(0);
  const height = ihdr.body.readUInt32BE(4);
  const depth = ihdr.body[8];
  const colour = ihdr.body[9];
  const interlace = ihdr.body[12];

  if (depth !== 8) throw new Error(`only 8-bit PNGs (got ${depth})`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`unsupported colour type ${colour}`);

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.body));
  const raw = inflateSync(idat);

  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));

    // Undo the per-scanline filter, in place, byte by byte as the spec defines.
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      line[i] = v & 0xff;
    }
    prev = line;

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (channels === 1) {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = 255;
      } else if (channels === 2) {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = line[s + 1];
      } else {
        out[d] = line[s];
        out[d + 1] = line[s + 1];
        out[d + 2] = line[s + 2];
        out[d + 3] = channels === 4 ? line[s + 3] : 255;
      }
    }
  }
  return { width, height, rgba: out };
}

/* ------------------------------------------------------------------ encode -- */

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

/** Always RGB. An App Store screenshot may not carry an alpha channel. */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour, no alpha
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = row + 1 + x * 3;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
