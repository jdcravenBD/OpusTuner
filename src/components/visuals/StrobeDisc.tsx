import { useRef } from 'react';
import { clamp, colourFor, useVisualCanvas, visualFont, type VisualProps } from './shared';

const TAU = Math.PI * 2;

/**
 * The harmonic each band stands for. Everything else about a band is derived
 * from this number and nothing else: a band carrying the 4th harmonic gets four
 * times the blocks (so each is a quarter the width) and travels four times as
 * fast. Add a `8` here and a fourth band appears, correctly proportioned.
 */
const HARMONICS = [1, 2, 4];
/** Blocks on the fundamental band, over the whole circle. Half are on screen. */
const BASE_BLOCKS = 28;

/*
 * Band geometry, as fractions of the square's side. The dial's centre sits on
 * the bottom edge and the outermost band reaches a full side-length out, so the
 * semicircle is nearly twice as wide as the screen and runs off both sides —
 * which is the point. Cropping the ends is what flattens the arcs enough for
 * the block edges to read as vertical columns rather than as spokes.
 */
const BAND_INNER = 0.535;
const BAND_THICKNESS = 0.145;
const BAND_GAP = 0.015;

/*
 * Speed.
 *
 * Linear near zero and compressing beyond the knee: sensitive where the last
 * cent lives, and still meaningful at a semitone out without running away.
 * Blocks per second on band k is `harmonic² × rate`, because the band moves
 * `harmonic` times as fast over blocks that are `harmonic` times narrower.
 */
/** Blocks per second on the fundamental band, per cent, near zero. */
const BLOCKS_PER_CENT = 0.5;
/** Cents at which the rate is half what a straight line would have given. */
const KNEE_CENTS = 34;
/**
 * Fastest any band may actually run. Past this a band is showing more edges per
 * second than the display has frames, and drawing it honestly would produce
 * backwards-crawling nonsense rather than information — so it is held here and
 * washed out instead. Bands falling out of resolution one by one as the error
 * grows is the ladder working, not a fault.
 */
const MAX_BLOCKS_PER_SEC = 20;
/** Contrast a fully washed-out band falls back to, rather than vanishing. */
const MIN_CONTRAST = 0.16;

/**
 * Rate on the *fastest* band below which the stack starts pulling itself into
 * alignment, and how hard it pulls once it does.
 *
 * Added as a velocity toward the nearest whole block rather than eased as a
 * position, so it can never jump: while the drift is winning it shows as a
 * ratchet near each edge, and once the drift dies it draws the columns
 * together. Every band snaps to its own block pitch, and those pitches are
 * multiples of one another, so aligning each band independently is what makes
 * the edges line up all the way through the stack.
 */
const LOCK_BLOCKS_PER_SEC = 4;
const SNAP_RATE = 9;

/**
 * The strobe.
 *
 * Three stacked bands, each carrying twice the harmonic of the one below it, so
 * each has blocks half as wide and runs twice as fast. Off pitch they slide —
 * one way for sharp, the other for flat — and slide out of step with one
 * another. On pitch they stop and their edges draw up into continuous columns
 * straight through the stack.
 *
 * Nothing to read and no needle to settle. Motion against stillness is about
 * the most sensitive thing human vision does, which is why the mechanical
 * original is still the reference instrument.
 */
export function StrobeDisc({ tolerance, themeKey }: VisualProps) {
  const phases = useRef(HARMONICS.map(() => 0));
  const displayCents = useRef(0);
  const signalFade = useRef(0);

  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;

  const canvasRef = useVisualCanvas({
    themeKey,
    draw: (ctx, size, p, frame, dt) => {
      const { w, h, dpr } = size;
      const S = Math.min(w, h);

      const target = frame.hasSignal ? frame.cents : 0;
      displayCents.current += (target - displayCents.current) * 0.18;
      signalFade.current += ((frame.hasSignal ? 1 : 0) - signalFade.current) * 0.1;

      const cents = displayCents.current;
      // Blocks per second on the fundamental band. c / (1 + |c| / knee) is a
      // straight line through the origin that bends over into a ceiling.
      const rate = (BLOCKS_PER_CENT * cents) / (1 + Math.abs(cents) / KNEE_CENTS);

      // The fastest band decides when the stack tries to lock, since it is the
      // last one still visibly moving.
      const fastest = HARMONICS[HARMONICS.length - 1];
      const lock = clamp(
        1 - (Math.abs(rate) * fastest * fastest) / LOCK_BLOCKS_PER_SEC,
        0,
        1,
      );

      const fade = signalFade.current;
      const alpha = 0.3 + fade * 0.7;
      const inTune = frame.hasSignal && Math.abs(frame.cents) <= toleranceRef.current;
      const hot = colourFor(p, frame.hasSignal ? frame.cents : 9999, toleranceRef.current);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Dial centre on the bottom edge; only the top half of the circle exists,
      // and the canvas crops whatever runs past the sides.
      const cx = w / 2;
      const cy = h;

      HARMONICS.forEach((harmonic, k) => {
        const blocks = BASE_BLOCKS * harmonic;
        const step = TAU / blocks;
        const inner = BAND_INNER + k * (BAND_THICKNESS + BAND_GAP);
        const rMid = (inner + BAND_THICKNESS / 2) * S;
        const thickness = BAND_THICKNESS * S;

        /* --- advance ---------------------------------------------------- */
        const wanted = rate * harmonic * harmonic; // blocks per second
        const shown = clamp(wanted, -MAX_BLOCKS_PER_SEC, MAX_BLOCKS_PER_SEC);
        let phase = phases.current[k];
        const nearest = Math.round(phase / step) * step;
        phase += (shown * step + lock * SNAP_RATE * (nearest - phase)) * dt;
        phase = ((phase % TAU) + TAU) % TAU;
        phases.current[k] = phase;

        // How far past legible this band is running, and hence how far its
        // blocks fade toward a flat translucent ring.
        const strain = Math.abs(wanted) / MAX_BLOCKS_PER_SEC;
        const contrast = 1 - clamp((strain - 1) / 2, 0, 1) * (1 - MIN_CONTRAST);

        /* --- track ------------------------------------------------------- */
        ctx.globalAlpha = 0.1 + (1 - contrast) * 0.14;
        ctx.strokeStyle = p.tick;
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.arc(cx, cy, rMid, Math.PI, TAU);
        ctx.stroke();

        /* --- blocks ------------------------------------------------------ */
        ctx.globalAlpha = alpha * contrast * (inTune ? 0.95 : 0.8);
        ctx.strokeStyle = hot;
        for (let i = 0; i < blocks; i++) {
          // Canvas angles run clockwise from due east; the visible half is the
          // upper one, [π, 2π). Everything else is below the bottom edge.
          const a = (phase + i * step + Math.PI) % TAU;
          if (a < Math.PI - step) continue;
          ctx.beginPath();
          ctx.arc(cx, cy, rMid, a, a + step * 0.5);
          ctx.stroke();
        }
      });

      /* --- index line at twelve o'clock ----------------------------------- */
      // The stationary reference. Without it the bands have nothing to be still
      // against, and "barely creeping" looks the same as "stopped". A block
      // edge lands exactly on it once the stack locks.
      const stackTop = BAND_INNER + HARMONICS.length * (BAND_THICKNESS + BAND_GAP);
      ctx.globalAlpha = inTune ? 0.95 : 0.5;
      ctx.strokeStyle = inTune ? p.green : p.tickHot;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - stackTop * S);
      ctx.lineTo(cx, cy - (BAND_INNER - 0.03) * S);
      ctx.stroke();

      /* --- inner rim ------------------------------------------------------ */
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = p.tick;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, (BAND_INNER - 0.03) * S, Math.PI, TAU);
      ctx.stroke();

      /* --- cent readout, in the well under the dial ------------------------ */
      if (frame.hasSignal) {
        const rounded = Math.round(frame.cents);
        const label = rounded === 0 ? '0' : `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)}`;
        ctx.font = visualFont(Math.max(15, Math.round(S * 0.13)));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = hot;
        ctx.fillText(label, cx, cy - S * 0.27);
      }

      ctx.restore();
    },
  });

  return <canvas ref={canvasRef} className="field__canvas" aria-hidden />;
}
