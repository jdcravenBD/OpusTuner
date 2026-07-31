/**
 * A fourteen-segment display, drawn on canvas.
 *
 * Fourteen rather than the seven of a bedside clock, because seven cannot spell
 * a note: it manages A, C, E, F and G but only lowercase b and d, and it has no
 * hope of "Sol" or "Mi" for anyone tuning in solfège. The starburst adds the
 * diagonals and the two centre verticals, which covers every letter this app
 * needs and still reads as an appliance rather than as typography.
 *
 * Segments are strokes rather than mitred polygons — at the sizes used here the
 * difference is a fraction of a pixel, and it keeps the glyph table legible.
 * Unlit segments are drawn faintly underneath, which is the detail that makes
 * the thing read as a display at all: without the ghost it is just some marks.
 *
 *      -- A --
 *     |\  |  /|
 *     F H I J B
 *     |  \|/  |
 *      G1 -- G2
 *     |  /|\  |
 *     E K L M C
 *     |/  |  \|
 *      -- D --
 */

const A = 1 << 0;
const B = 1 << 1;
const C = 1 << 2;
const D = 1 << 3;
const E = 1 << 4;
const F = 1 << 5;
const G1 = 1 << 6;
const G2 = 1 << 7;
const H = 1 << 8;
const I = 1 << 9;
const J = 1 << 10;
const K = 1 << 11;
const L = 1 << 12;
const M = 1 << 13;

/** Endpoints of each segment in a unit cell: x and y both run 0…1. */
const GEOMETRY: [number, number[], number[]][] = [
  [A, [0, 0], [1, 0]],
  [B, [1, 0], [1, 0.5]],
  [C, [1, 0.5], [1, 1]],
  [D, [0, 1], [1, 1]],
  [E, [0, 0.5], [0, 1]],
  [F, [0, 0], [0, 0.5]],
  [G1, [0, 0.5], [0.5, 0.5]],
  [G2, [0.5, 0.5], [1, 0.5]],
  [H, [0, 0], [0.5, 0.5]],
  [I, [0.5, 0], [0.5, 0.5]],
  [J, [1, 0], [0.5, 0.5]],
  [K, [0, 1], [0.5, 0.5]],
  [L, [0.5, 0.5], [0.5, 1]],
  [M, [1, 1], [0.5, 0.5]],
];

/**
 * Which segments each character lights.
 *
 * Covers the digits, the note letters A–G, and the letters solfège needs
 * (D, O, R, E, M, I, F, A, S, L). Anything absent renders as a blank cell,
 * which is what a real display would do with it.
 */
const GLYPHS: Record<string, number> = {
  '0': A | B | C | D | E | F,
  '1': B | C,
  '2': A | B | G1 | G2 | E | D,
  '3': A | B | C | D | G1 | G2,
  '4': F | G1 | G2 | B | C,
  '5': A | F | G1 | G2 | C | D,
  '6': A | F | E | D | C | G1 | G2,
  '7': A | B | C,
  '8': A | B | C | D | E | F | G1 | G2,
  '9': A | B | C | D | F | G1 | G2,
  A: A | B | C | E | F | G1 | G2,
  B: A | B | C | D | G2 | I | L,
  C: A | D | E | F,
  D: A | B | C | D | I | L,
  E: A | D | E | F | G1 | G2,
  F: A | E | F | G1,
  G: A | C | D | E | F | G2,
  I: A | D | I | L,
  L: D | E | F,
  M: B | C | E | F | H | J,
  O: A | B | C | D | E | F,
  R: A | B | E | F | G1 | G2 | M,
  S: A | C | D | F | G1 | G2,
  '-': G1 | G2,
  '+': G1 | G2 | I | L,
  ' ': 0,
};

/** Cell proportions, and the lean that says "clock" rather than "label". */
const ASPECT = 0.62;
const GAP = 0.2;
const STROKE = 0.1;
const SLANT = 0.1;

export interface SegmentStyle {
  colour: string;
  /** Alpha for lit segments. */
  alpha: number;
  /** Alpha for the unlit ones showing through behind. */
  ghost: number;
}

/** Total width a string will occupy at a given cell height. */
export function segmentWidth(text: string, height: number): number {
  const n = text.length;
  return n * height * ASPECT + Math.max(0, n - 1) * height * GAP;
}

/**
 * Draws `text` centred on (cx, cy).
 *
 * `♯` and `♭` get drawn properly rather than approximated out of segments —
 * a starburst cannot make either of them, and a note name without its
 * accidental is a different note.
 */
export function drawSegmentText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  height: number,
  style: SegmentStyle,
): void {
  const cellW = height * ASPECT;
  const gap = height * GAP;
  const total = segmentWidth(text, height);
  const left = cx - total / 2;
  const top = cy - height / 2;

  ctx.save();
  ctx.lineWidth = height * STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.colour;
  // Shear about the vertical centre so the lean does not shift the baseline.
  ctx.transform(1, 0, SLANT, 1, -SLANT * cy, 0);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const x = left + i * (cellW + gap);

    if (ch === '♯' || ch === '♭') {
      drawAccidental(ctx, ch === '♯', x, top, cellW, height, style);
      continue;
    }

    const mask = GLYPHS[ch.toUpperCase()] ?? 0;
    for (const pass of [0, 1]) {
      const alpha = pass === 0 ? style.ghost : style.alpha;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const [bit, from, to] of GEOMETRY) {
        const lit = (mask & bit) !== 0;
        if (pass === 0 ? lit : !lit) continue;
        ctx.moveTo(x + from[0] * cellW, top + from[1] * height);
        ctx.lineTo(x + to[0] * cellW, top + to[1] * height);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawAccidental(
  ctx: CanvasRenderingContext2D,
  sharp: boolean,
  x: number,
  y: number,
  w: number,
  h: number,
  style: SegmentStyle,
): void {
  ctx.globalAlpha = style.alpha;
  ctx.beginPath();
  if (sharp) {
    // Two uprights crossed by two rising bars, the way it is engraved.
    ctx.moveTo(x + w * 0.34, y + h * 0.1);
    ctx.lineTo(x + w * 0.28, y + h * 0.9);
    ctx.moveTo(x + w * 0.72, y + h * 0.08);
    ctx.lineTo(x + w * 0.66, y + h * 0.88);
    ctx.moveTo(x + w * 0.08, y + h * 0.44);
    ctx.lineTo(x + w * 0.92, y + h * 0.34);
    ctx.moveTo(x + w * 0.08, y + h * 0.7);
    ctx.lineTo(x + w * 0.92, y + h * 0.6);
  } else {
    ctx.moveTo(x + w * 0.3, y + h * 0.06);
    ctx.lineTo(x + w * 0.3, y + h * 0.94);
    ctx.moveTo(x + w * 0.3, y + h * 0.52);
    ctx.quadraticCurveTo(x + w * 0.95, y + h * 0.5, x + w * 0.72, y + h * 0.76);
    ctx.lineTo(x + w * 0.3, y + h * 0.94);
  }
  ctx.stroke();
}
