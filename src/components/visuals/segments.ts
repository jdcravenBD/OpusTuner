/**
 * The strobe's readout, in a real seven-segment face.
 *
 * The typeface is 7-Segment by Jan Bobrowski, bundled under the SIL OFL and
 * loaded by this module rather than declared in the stylesheet — see
 * loadSegmentFont for why. It carries the digits, the whole alphabet
 * (so solfège spells properly) and a hyphen, but three characters this app
 * needs are not in it and could not be: a seven-segment cell cannot form a
 * plus, a sharp or a flat. Those are drawn as paths at a stroke weight matched
 * to the font's own, so a mixed string still reads as one display.
 *
 * Unlit segments show through faintly behind the lit ones. That is done by
 * printing a dim `8` in every cell first, which lights all seven — the same
 * trick the hardware plays, and the detail that makes the thing read as a
 * display rather than as text.
 *
 * If the face cannot be had at all the readout still draws, in the monospace
 * stack below and without the segment flourishes. It will not look like a
 * display, which is much better than the alternative: the note vanishing.
 */

import fontUrl from '../../assets/7segment.ttf';

const FAMILY = 'SevenSegment';
/** What the readout is set in until, or unless, the face arrives. */
const FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
/** Characters drawn by hand because the face has no glyph for them. */
const DRAWN = new Set(['+', '♯', '♭']);
/** Width of a drawn cell, relative to the font size. */
const DRAWN_WIDTH = 0.52;
/** Stroke weight of a drawn glyph, relative to the font size. */
const DRAWN_STROKE = 0.1;

let loading: Promise<void> | null = null;
let ready = false;

/**
 * Fetches the face, without depending on the stylesheet to do it.
 *
 * This was `document.fonts.load()` against a `@font-face` in app.css, and there
 * was a race in it that cost the strobe its entire readout. `load()` only
 * fetches faces that are *already registered*: called before the stylesheet
 * has been parsed into the CSSOM it matches nothing, resolves immediately
 * having fetched nothing at all, and latches `loading` so it never asks again.
 *
 * That ordering was real rather than theoretical. In the built app Vite puts
 * the module script *above* the stylesheet link, and this is called at the
 * top of main.tsx; in dev the CSS is injected by the `import` a few lines
 * above, so the bug could not be seen there at all. It showed as the note and
 * the cents simply missing from the strobe, and coming back after clearing
 * site data — a cold load loses the race the other way round.
 *
 * Building the FontFace here removes the question: the URL is a build-time
 * import, hashed and precached like any other asset, and `load()` on a face
 * you constructed yourself always actually fetches.
 */
export function loadSegmentFont(): void {
  if (loading || ready || typeof document === 'undefined' || !document.fonts) return;
  const face = new FontFace(FAMILY, `url(${JSON.stringify(fontUrl)}) format('truetype')`);
  loading = face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      ready = true;
    })
    .catch(() => {
      // Cleared rather than left set, so a later mount can try again. Nothing
      // calls this per frame, so a retry cannot run away.
      loading = null;
    });
}

/**
 * True once the face is genuinely loaded.
 *
 * Our own flag rather than `document.fonts.check()`, which cannot answer this
 * question: for a family with no registered face it reports *true* in Chrome
 * (the fallback can render the text) and false in WebKit. Neither is the
 * answer being asked for. The readout is no longer gated on this at all — it
 * now only decides whether the segment flourishes are drawn.
 */
export function segmentFontReady(): boolean {
  return ready;
}

/** What to set the readout in, whichever of the two we have. */
function fontFor(size: number): string {
  return `${size}px "${FAMILY}", ${FALLBACK}`;
}

export interface SegmentStyle {
  color: string;
  /** Alpha for lit segments. */
  alpha: number;
  /** Alpha for the unlit ones showing through behind. */
  ghost: number;
}

/**
 * Hand-drawn only while the segment face is the one in use. The widths and
 * stroke weights below are matched to its digits, and against a fallback
 * monospace they would sit at the wrong weight — and there is nothing to
 * make up for there, since a normal face has all three characters.
 */
function drawn(ch: string): boolean {
  return ready && DRAWN.has(ch);
}

function cellWidth(ctx: CanvasRenderingContext2D, ch: string, size: number): number {
  return drawn(ch) ? size * DRAWN_WIDTH : ctx.measureText(ch).width;
}

/** Total width a string will occupy at a given font size. */
export function segmentWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
): number {
  ctx.save();
  ctx.font = fontFor(size);
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
  ctx.font = fontFor(size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * DRAWN_STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.color;

  const widths = [...text].map((ch) => cellWidth(ctx, ch, size));
  const total = widths.reduce((a, b) => a + b, 0);
  let x = cx - total / 2;

  [...text].forEach((ch, i) => {
    const w = widths[i];
    // The unlit cell behind. An 8 lights every segment there is — and means
    // nothing whatever in a face that has no segments.
    if (style.ghost > 0 && ready) {
      ctx.globalAlpha = style.ghost;
      ctx.fillText('8', x, cy);
    }
    ctx.globalAlpha = style.alpha;
    if (drawn(ch)) drawGlyph(ctx, ch, x, cy, w, size);
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
