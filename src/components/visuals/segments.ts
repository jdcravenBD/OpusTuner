/**
 * The strobe's readout, in a real seven-segment face.
 *
 * The typeface is 7-Segment by Jan Bobrowski, bundled under the SIL OFL — see
 * the @font-face in styles/app.css. It carries the digits, the whole alphabet
 * (so solfège spells properly) and a hyphen, but three characters this app
 * needs are not in it and could not be: a seven-segment cell cannot form a
 * plus, a sharp or a flat. Those are drawn as paths at a stroke weight matched
 * to the font's own, so a mixed string still reads as one display.
 *
 * Unlit segments show through faintly behind the lit ones. That is done by
 * printing a dim `8` in every cell first, which lights all seven — the same
 * trick the hardware plays, and the detail that makes the thing read as a
 * display rather than as text.
 */

const FAMILY = 'SevenSegment';
/** Characters drawn by hand because the face has no glyph for them. */
const DRAWN = new Set(['+', '♯', '♭']);
/** Width of a drawn cell, relative to the font size. */
const DRAWN_WIDTH = 0.52;
/** Stroke weight of a drawn glyph, relative to the font size. */
const DRAWN_STROKE = 0.1;

let loading: Promise<void> | null = null;
let ready = false;

/**
 * Starts fetching the face, once.
 *
 * A `@font-face` is only fetched when something in the DOM renders with it, and
 * nothing here does — the readout is painted on a canvas. Without this the
 * font would sit in the stylesheet unused and `ctx.font` would quietly fall
 * back to a system sans.
 */
export function loadSegmentFont(): void {
  if (loading || typeof document === 'undefined' || !document.fonts) return;
  loading = document.fonts
    .load(`16px "${FAMILY}"`)
    .then(() => {
      ready = document.fonts.check(`16px "${FAMILY}"`);
    })
    .catch(() => {
      ready = false;
    });
}

/** True once the face is available to canvas. */
export function segmentFontReady(): boolean {
  if (!ready && typeof document !== 'undefined' && document.fonts) {
    ready = document.fonts.check(`16px "${FAMILY}"`);
  }
  return ready;
}

export interface SegmentStyle {
  colour: string;
  /** Alpha for lit segments. */
  alpha: number;
  /** Alpha for the unlit ones showing through behind. */
  ghost: number;
}

function cellWidth(ctx: CanvasRenderingContext2D, ch: string, size: number): number {
  return DRAWN.has(ch) ? size * DRAWN_WIDTH : ctx.measureText(ch).width;
}

/** Total width a string will occupy at a given font size. */
export function segmentWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
): number {
  ctx.save();
  ctx.font = `${size}px "${FAMILY}"`;
  let w = 0;
  for (const ch of text) w += cellWidth(ctx, ch, size);
  ctx.restore();
  return w;
}

/** Draws `text` centred on (cx, cy). Returns the width it occupied. */
export function drawSegmentText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  size: number,
  style: SegmentStyle,
): number {
  ctx.save();
  ctx.font = `${size}px "${FAMILY}"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * DRAWN_STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = style.colour;
  ctx.strokeStyle = style.colour;

  const widths = [...text].map((ch) => cellWidth(ctx, ch, size));
  const total = widths.reduce((a, b) => a + b, 0);
  let x = cx - total / 2;

  [...text].forEach((ch, i) => {
    const w = widths[i];
    // The unlit cell behind. An 8 lights every segment there is.
    if (style.ghost > 0) {
      ctx.globalAlpha = style.ghost;
      ctx.fillText('8', x, cy);
    }
    ctx.globalAlpha = style.alpha;
    if (DRAWN.has(ch)) drawGlyph(ctx, ch, x, cy, w, size);
    else ctx.fillText(ch, x, cy);
    x += w;
  });

  ctx.restore();
  return total;
}

/**
 * The three characters the face has no cell for. Proportioned against the
 * digits either side of them rather than against the cell, so they sit at the
 * same visual weight.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  cy: number,
  w: number,
  size: number,
): void {
  const h = size * 0.62; // roughly the digit height of this face
  const top = cy - h / 2;
  ctx.beginPath();
  if (ch === '+') {
    ctx.moveTo(x + w * 0.5, cy - h * 0.3);
    ctx.lineTo(x + w * 0.5, cy + h * 0.3);
    ctx.moveTo(x + w * 0.16, cy);
    ctx.lineTo(x + w * 0.84, cy);
  } else if (ch === '♯') {
    // Two uprights crossed by two rising bars, the way it is engraved.
    ctx.moveTo(x + w * 0.38, top + h * 0.08);
    ctx.lineTo(x + w * 0.31, top + h * 0.92);
    ctx.moveTo(x + w * 0.71, top + h * 0.06);
    ctx.lineTo(x + w * 0.64, top + h * 0.9);
    ctx.moveTo(x + w * 0.14, top + h * 0.42);
    ctx.lineTo(x + w * 0.88, top + h * 0.32);
    ctx.moveTo(x + w * 0.14, top + h * 0.68);
    ctx.lineTo(x + w * 0.88, top + h * 0.58);
  } else {
    ctx.moveTo(x + w * 0.34, top);
    ctx.lineTo(x + w * 0.34, top + h);
    ctx.moveTo(x + w * 0.34, top + h * 0.5);
    ctx.quadraticCurveTo(x + w * 0.94, top + h * 0.48, x + w * 0.72, top + h * 0.78);
    ctx.lineTo(x + w * 0.34, top + h);
  }
  ctx.stroke();
}
