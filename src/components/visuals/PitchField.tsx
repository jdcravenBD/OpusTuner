import { useRef } from 'react';
import { pitchClassName } from '../../music/notes';
import type { NoteNaming } from '../../music/notes';
import type { TunerFrame } from '../../tuner/TunerController';
import {
  clamp,
  colourFor,
  useVisualCanvas,
  visualFont,
  type Palette,
  type Size,
  type VisualProps,
} from './shared';

const RANGE_CENTS = 250; // field edge = 250 cents off
const MAJOR_TICK_CENTS = 100; // semitone boundaries
const MINOR_TICK_CENTS = 50;

/**
 * Where the marker sits, as a fraction of the field height. Leaves room above
 * the nib for the cent readout, and above that for the note-name gridlabels.
 */
const MARKER_Y = 0.28;
/** How fast the world falls, in CSS px per second. */
const SCROLL_PX_PER_SEC = 62;
/** Spacing of the scrolling horizontal rules. */
const GRID_SPACING = 38;
/** Trail samples per second. */
const TRAIL_HZ = 40;
/** Ring-buffer capacity — enough to fill the field at the slowest useful rate. */
const TRAIL_CAPACITY = 256;

/**
 * The tuning field.
 *
 * A square window onto a world that scrolls steadily downward. The marker is
 * pinned vertically and only ever moves left and right, so the falling
 * background reads as the marker climbing — and the trail it leaves behind
 * becomes a legible history of the last few seconds of pitch, dropping away
 * beneath it at exactly the same rate as the background.
 *
 * Driven straight from the tuner's frame stream; React never re-renders this
 * while a note is sounding.
 */
export function PitchField({ tolerance, themeKey, naming, fallbackMidi }: VisualProps) {
  /**
   * Offscreen buffer for the trail. The trail is stroked opaque in here so that
   * where it crosses itself nothing accumulates, then faded once on the way
   * out — see drawTrail().
   */
  const trailCanvas = useRef<HTMLCanvasElement | null>(null);

  // All animation state lives in refs — mutated 60x/s, never through React.
  const displayCents = useRef(0);
  const signalFade = useRef(0);
  const scrollOffset = useRef(0);
  const sampleAccum = useRef(0);

  // Trail ring buffer. `y` is absolute and grows as each sample falls.
  const trail = useRef({
    x: new Float32Array(TRAIL_CAPACITY),
    cents: new Float32Array(TRAIL_CAPACITY),
    y: new Float32Array(TRAIL_CAPACITY),
    live: new Uint8Array(TRAIL_CAPACITY),
    head: 0,
    count: 0,
  });

  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const namingRef = useRef(naming);
  namingRef.current = naming;
  const fallbackRef = useRef(fallbackMidi);
  fallbackRef.current = fallbackMidi;

  const canvasRef = useVisualCanvas({
    themeKey,
    onResize: (size) => {
      if (!trailCanvas.current) trailCanvas.current = document.createElement('canvas');
      trailCanvas.current.width = Math.round(size.w * size.dpr);
      trailCanvas.current.height = Math.round(size.h * size.dpr);
      trail.current.count = 0; // geometry changed; old positions are meaningless
    },
    draw: (ctx, size, palette, frame, dt) => {
      const { w, h } = size;

      const fall = SCROLL_PX_PER_SEC * dt;
      scrollOffset.current = (scrollOffset.current + fall) % GRID_SPACING;

      const target = clamp(frame.cents, -RANGE_CENTS * 1.2, RANGE_CENTS * 1.2);
      displayCents.current += (target - displayCents.current) * 0.3;
      signalFade.current += ((frame.hasSignal ? 1 : 0) - signalFade.current) * 0.1;

      /* --- age the trail, then sample the current position ---------------- */
      const t = trail.current;
      const markerY = h * MARKER_Y;
      for (let i = 0; i < t.count; i++) {
        const idx = (t.head - 1 - i + TRAIL_CAPACITY * 2) % TRAIL_CAPACITY;
        t.y[idx] += fall;
      }
      // Drop anything that has fallen out of the bottom of the field.
      while (t.count > 0) {
        const oldest = (t.head - t.count + TRAIL_CAPACITY * 2) % TRAIL_CAPACITY;
        if (t.y[oldest] <= h) break;
        t.count--;
      }

      sampleAccum.current += dt;
      const interval = 1 / TRAIL_HZ;
      if (sampleAccum.current >= interval) {
        sampleAccum.current %= interval;
        t.x[t.head] = xOf(w, displayCents.current);
        t.cents[t.head] = frame.cents;
        t.live[t.head] = frame.hasSignal ? 1 : 0;
        t.y[t.head] = markerY;
        t.head = (t.head + 1) % TRAIL_CAPACITY;
        if (t.count < TRAIL_CAPACITY) t.count++;
      }

      draw(ctx, size, palette, frame, {
        cents: displayCents.current,
        fade: signalFade.current,
        tolerance: toleranceRef.current,
        scroll: scrollOffset.current,
        naming: namingRef.current,
        fallbackMidi: fallbackRef.current,
        trail: t,
        buffer: trailCanvas.current,
      });
    },
  });

  return <canvas ref={canvasRef} className="field__canvas" aria-hidden />;
}

/* ------------------------------------------------------------------ layout -- */

function xOf(w: number, cents: number): number {
  const pad = Math.min(24, w * 0.075);
  const half = (w - pad * 2) / 2;
  return w / 2 + (clamp(cents, -RANGE_CENTS, RANGE_CENTS) / RANGE_CENTS) * half;
}

interface DrawState {
  cents: number;
  fade: number;
  tolerance: number;
  scroll: number;
  naming: NoteNaming;
  fallbackMidi: number;
  trail: Trail;
  buffer: HTMLCanvasElement | null;
}

interface Trail {
  x: Float32Array;
  cents: Float32Array;
  y: Float32Array;
  live: Uint8Array;
  head: number;
  count: number;
}

/**
 * The marker: an inverted nib. Wide and rounded across the top, with both
 * lower edges curving inward so they taper to a hairline at the bottom — the
 * tip is the reading, and it wants to be as fine as the accuracy behind it.
 */
function nibPath(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const W = 13 * scale; // half-width at the shoulders
  const H = 30 * scale; // tip to crown

  ctx.beginPath();
  ctx.moveTo(x, y); // the point
  // left edge, sweeping up and out — concave, so it narrows sharply near the tip
  ctx.bezierCurveTo(
    x - W * 0.14,
    y - H * 0.34,
    x - W * 0.70,
    y - H * 0.56,
    x - W,
    y - H * 0.80,
  );
  // rounded crown
  ctx.quadraticCurveTo(x - W * 0.66, y - H * 1.03, x, y - H * 1.03);
  ctx.quadraticCurveTo(x + W * 0.66, y - H * 1.03, x + W, y - H * 0.80);
  // right edge, mirrored back down to the point
  ctx.bezierCurveTo(
    x + W * 0.70,
    y - H * 0.56,
    x + W * 0.14,
    y - H * 0.34,
    x,
    y,
  );
  ctx.closePath();
}

function draw(
  ctx: CanvasRenderingContext2D,
  size: Size,
  p: Palette,
  frame: TunerFrame,
  s: DrawState,
): void {
  const { w, h, dpr } = size;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const markerY = h * MARKER_Y;
  const inTune = frame.hasSignal && Math.abs(frame.cents) <= s.tolerance;
  const hot = colourFor(p, frame.hasSignal ? frame.cents : 9999, s.tolerance);
  const alpha = 0.32 + s.fade * 0.68;

  /** Fades everything out toward the bottom of the field. */
  const depthFade = (y: number) => {
    const d = (y - markerY) / Math.max(1, h - markerY);
    return clamp(1 - d * 0.92, 0, 1);
  };

  /* --- falling horizontal rules ---------------------------------------- */
  // These are the whole point of the field: the marker is pinned, so the only
  // thing that says "you are moving" is the world sliding past underneath.
  ctx.lineWidth = 1;
  ctx.strokeStyle = p.tick;
  for (let y = s.scroll - GRID_SPACING; y < h + GRID_SPACING; y += GRID_SPACING) {
    if (y < 0 || y > h) continue;
    ctx.globalAlpha = 0.16 * depthFade(y);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  /* --- fixed cent gridlines -------------------------------------------- */
  for (let c = -RANGE_CENTS; c <= RANGE_CENTS; c += MINOR_TICK_CENTS) {
    if (c === 0) continue;
    const isMajor = c % MAJOR_TICK_CENTS === 0;
    const x = xOf(w, c);
    ctx.globalAlpha = isMajor ? 0.3 : 0.15;
    ctx.strokeStyle = p.tick;
    ctx.lineWidth = isMajor ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  /* --- in-tune corridor and centre line --------------------------------- */
  const tolX = xOf(w, s.tolerance) - w / 2;
  ctx.globalAlpha = inTune ? 0.2 : 0.09;
  ctx.fillStyle = p.green;
  ctx.fillRect(w / 2 - tolX, 0, tolX * 2, h);

  ctx.globalAlpha = inTune ? 0.95 : 0.4;
  ctx.strokeStyle = inTune ? p.green : p.tick;
  ctx.lineWidth = inTune ? 2 : 1.5;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();

  /* --- neighbouring note names along the top ---------------------------- */
  // The semitone gridlines are labelled with the notes they actually are, so
  // a string sitting a semitone sharp reads as landing on a named note rather
  // than as an abstract "+1".
  const refMidi = frame.targetMidi > 0 ? frame.targetMidi : s.fallbackMidi;
  if (refMidi > 0) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = p.text3;
    ctx.font = visualFont(Math.max(10, Math.round(h * 0.042)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const c of [-200, -100, 100, 200]) {
      ctx.fillText(pitchClassName(refMidi + c / 100, s.naming), xOf(w, c), 7);
    }
  }

  /* --- the trail -------------------------------------------------------- */
  const x = xOf(w, s.cents);
  drawTrail(ctx, s.buffer, size, p, s, markerY, x, hot, alpha);

  /* --- the marker ------------------------------------------------------- */
  const scale = 0.7 + s.fade * 0.3;

  ctx.globalAlpha = alpha;
  ctx.shadowColor = hot;
  ctx.shadowBlur = inTune ? 22 : 12;
  ctx.fillStyle = hot;
  nibPath(ctx, x, markerY, scale);
  ctx.fill();
  ctx.shadowBlur = 0;

  /* --- cent readout, riding above the nib -------------------------------- */
  if (frame.hasSignal) {
    const cents = Math.round(frame.cents);
    const label = cents === 0 ? '0' : `${cents > 0 ? '+' : '-'}${Math.abs(cents)}`;
    const fontSize = Math.max(13, Math.round(h * 0.055));
    ctx.font = visualFont(fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Rides with the marker but stays clear of the field edges.
    const margin = ctx.measureText('-250').width / 2 + 4;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hot;
    ctx.fillText(label, clamp(x, margin, w - margin), markerY - 31 * scale - 9);
  }

  // Bright inner highlight keeps the nib legible on top of its own glow.
  ctx.globalAlpha = alpha * 0.8;
  ctx.fillStyle = '#ffffff';
  nibPath(ctx, x, markerY, scale * 0.44);
  ctx.fill();

  ctx.restore();
}

/**
 * Renders the pitch trail.
 *
 * Every segment is stroked at full opacity into an offscreen buffer, and the
 * depth fade is applied afterwards as a single gradient mask. Stroking the
 * segments straight onto the field with partial alpha would composite them
 * against each other — so every round cap join, and every place the trail
 * crosses back over itself, would show up as a denser patch. Painting opaque
 * first makes overlap a no-op, and one `drawImage` puts a perfectly even trail
 * on the field.
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  buffer: HTMLCanvasElement | null,
  size: Size,
  p: Palette,
  s: DrawState,
  markerY: number,
  markerX: number,
  hot: string,
  alpha: number,
): void {
  const { w, h, dpr } = size;
  const t = s.trail;
  if (!buffer || t.count < 2) return;
  const bctx = buffer.getContext('2d');
  if (!bctx) return;

  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.clearRect(0, 0, w, h);
  bctx.globalCompositeOperation = 'source-over';
  bctx.globalAlpha = 1;
  bctx.lineCap = 'round';
  bctx.lineJoin = 'round';

  // Join the nib to the head of the trail so the stroke reads as continuous.
  const newest = (t.head - 1 + TRAIL_CAPACITY) % TRAIL_CAPACITY;
  if (t.live[newest]) {
    bctx.strokeStyle = hot;
    bctx.lineWidth = 3;
    bctx.beginPath();
    bctx.moveTo(markerX, markerY);
    bctx.lineTo(t.x[newest], t.y[newest]);
    bctx.stroke();
  }

  // Newest (just under the marker) to oldest (falling out of the bottom).
  // Connected segments rather than dots: the marker can travel further
  // horizontally between samples than its own width.
  for (let i = 0; i < t.count - 1; i++) {
    const a = (t.head - 1 - i + TRAIL_CAPACITY * 2) % TRAIL_CAPACITY;
    const b = (t.head - 2 - i + TRAIL_CAPACITY * 2) % TRAIL_CAPACITY;
    if (!t.live[a] || !t.live[b]) continue; // gap where nothing was sounding
    if (t.y[a] > h) continue;
    const depth = clamp(1 - (t.y[a] - markerY) / Math.max(1, h - markerY), 0, 1);
    bctx.strokeStyle = colourFor(p, t.cents[a], s.tolerance);
    bctx.lineWidth = 1 + depth * 2;
    bctx.beginPath();
    bctx.moveTo(t.x[a], t.y[a]);
    bctx.lineTo(t.x[b], t.y[b]);
    bctx.stroke();
  }

  // Fade with depth in one pass, so the gradient can't interact with overlap.
  const grad = bctx.createLinearGradient(0, markerY, 0, h);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.62)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  bctx.globalCompositeOperation = 'destination-in';
  bctx.fillStyle = grad;
  bctx.fillRect(0, 0, w, h);
  bctx.globalCompositeOperation = 'source-over';

  ctx.globalAlpha = alpha * 0.92;
  ctx.drawImage(buffer, 0, 0, w, h);
}
