import { useRef } from 'react';
import { noteOctave, pitchClassName } from '../../music/notes';
import {
  drawSegmentText,
  loadSegmentFont,
  segmentFontReady,
  segmentWidth,
} from './segments';
import { clamp, useVisualCanvas, type VisualProps } from './shared';

const TAU = Math.PI * 2;

/**
 * The harmonic each band stands for. Everything else about a band is derived
 * from this number and nothing else: a band carrying the 4th harmonic gets four
 * times the blocks (so each is a quarter the width) and travels four times as
 * fast. Add a `8` here and a fourth band appears, correctly proportioned.
 */
const HARMONICS = [1, 2, 4];
/** Blocks on the fundamental band, over the whole circle. Half are on screen. */
const BASE_BLOCKS = 7;

/*
 * Band geometry, as fractions of the square's side. The dial's centre sits on
 * the bottom edge and the outermost band reaches a full side-length out, so the
 * semicircle is nearly twice as wide as the screen and runs off both sides —
 * which is the point. Cropping the ends is what flattens the arcs enough for
 * the block edges to read as vertical columns rather than as spokes.
 *
 * The stack is anchored at its *outer* edge and grows inward, so the dial keeps
 * filling the screen whatever the band thickness or however many bands there
 * are. That outer edge stops short of the top, leaving the dial sitting in the
 * screen rather than jammed against it.
 */
const BAND_OUTER = 0.92;
const BAND_THICKNESS = 0.109;
const BAND_GAP = 0.015;
const BAND_INNER =
  BAND_OUTER - HARMONICS.length * BAND_THICKNESS - (HARMONICS.length - 1) * BAND_GAP;

/* Readout placement in the well below the dial, as fractions of the side. */
const NOTE_Y = 0.66;
const NOTE_SIZE = 0.21;
const CENTS_Y = 0.855;
const CENTS_SIZE = 0.13;

/*
 * Speed.
 *
 * Calibrated in *degrees* per second, not blocks per second, so that changing
 * how wide the blocks are does not change how fast the dial appears to move.
 * Linear near zero and compressing beyond the knee: sensitive where the last
 * cent lives, and still meaningful at a semitone out without running away.
 * Band k sweeps `harmonic` times as fast as the fundamental — which over blocks
 * that are `harmonic` times narrower means `harmonic²` times as many edges pass
 * a given point.
 */
/** Degrees per second on the fundamental band, per cent, near zero. */
const DEG_PER_CENT = 4.82;
/** Cents at which the rate is half what a straight line would have given. */
const KNEE_CENTS = 34;
/**
 * Two ceilings, whichever bites first, because a band can become unreadable in
 * two different ways. Sweeping too fast, and the eye cannot follow a feature
 * across the arc; passing too many edges a second, and there are more of them
 * than the display has frames, so drawing it honestly yields backwards-crawling
 * nonsense. Past either, a band is held at the limit and washed out instead.
 * Bands dropping out one at a time as the error grows is the ladder working,
 * not a fault — and wider blocks push the second limit further out, which is
 * exactly right.
 */
const MAX_DEG_PER_SEC = 240;
const MAX_BLOCKS_PER_SEC = 20;
/** Contrast a fully washed-out band falls back to, rather than vanishing. */
const MIN_CONTRAST = 0.16;

/**
 * Sweep rate on the *fastest* band below which the stack starts pulling itself
 * into alignment, and how hard it pulls once it does.
 *
 * Added as a velocity toward the nearest whole block rather than eased as a
 * position, so it can never jump: while the drift is winning it shows as a
 * ratchet near each edge, and once the drift dies it draws the columns
 * together. Every band snaps to its own block pitch, and those pitches are
 * multiples of one another, so aligning each band independently is what makes
 * the edges line up all the way through the stack.
 */
const LOCK_DEG_PER_SEC = 9.75;
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
export function StrobeDisc({ themeKey, naming, fallbackMidi }: VisualProps) {
  const phases = useRef(HARMONICS.map(() => 0));
  const displayCents = useRef(0);
  const signalFade = useRef(0);

  const namingRef = useRef(naming);
  namingRef.current = naming;
  const fallbackRef = useRef(fallbackMidi);
  fallbackRef.current = fallbackMidi;

  loadSegmentFont();

  const canvasRef = useVisualCanvas({
    themeKey,
    draw: (ctx, size, p, frame, dt) => {
      const { w, h, dpr } = size;
      const S = Math.min(w, h);

      const target = frame.hasSignal ? frame.cents : 0;
      displayCents.current += (target - displayCents.current) * 0.18;
      signalFade.current += ((frame.hasSignal ? 1 : 0) - signalFade.current) * 0.1;

      const cents = displayCents.current;
      // Degrees per second on the fundamental band. c / (1 + |c| / knee) is a
      // straight line through the origin that bends over into a ceiling.
      const rate = (DEG_PER_CENT * cents) / (1 + Math.abs(cents) / KNEE_CENTS);

      // The fastest band decides when the stack tries to lock, since it is the
      // last one still visibly moving.
      const fastest = HARMONICS[HARMONICS.length - 1];
      const lock = clamp(1 - (Math.abs(rate) * fastest) / LOCK_DEG_PER_SEC, 0, 1);

      const fade = signalFade.current;
      const alpha = 0.3 + fade * 0.7;
      // One colour throughout. A strobe answers by moving or not moving, and a
      // dial that also changes colour is answering the same question twice —
      // worse, it invites you to read the colour instead of the motion, which
      // is the less precise of the two by a wide margin.
      const hot = p.amber;

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
        const wantedDeg = rate * harmonic;
        const stepDeg = 360 / blocks;
        // How far past legible this band is running, by whichever measure is
        // worse — and hence how far its blocks fade toward a flat ring.
        const strain = Math.max(
          Math.abs(wantedDeg) / MAX_DEG_PER_SEC,
          Math.abs(wantedDeg) / stepDeg / MAX_BLOCKS_PER_SEC,
        );
        const shownDeg = strain > 1 ? wantedDeg / strain : wantedDeg;
        const contrast = 1 - clamp((strain - 1) / 2, 0, 1) * (1 - MIN_CONTRAST);

        let phase = phases.current[k];
        const nearest = Math.round(phase / step) * step;
        const drift = (shownDeg * Math.PI) / 180;
        phase += (drift + lock * SNAP_RATE * (nearest - phase)) * dt;
        phase = ((phase % TAU) + TAU) % TAU;
        phases.current[k] = phase;

        /* --- track ------------------------------------------------------- */
        ctx.globalAlpha = 0.1 + (1 - contrast) * 0.14;
        ctx.strokeStyle = p.tick;
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.arc(cx, cy, rMid, Math.PI, TAU);
        ctx.stroke();

        /* --- blocks ------------------------------------------------------ */
        ctx.globalAlpha = alpha * contrast * 0.85;
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

      /* --- inner rim ------------------------------------------------------ */
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = p.tick;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, (BAND_INNER - 0.03) * S, Math.PI, TAU);
      ctx.stroke();

      /* --- the readout, in the well under the dial ------------------------- */
      // Note over cents, on a segment display. The note is the larger of the
      // two because it is the one you look for; the cents are the fine print
      // you only consult once the bands are nearly still.
      const midi = frame.targetMidi > 0 ? frame.targetMidi : fallbackRef.current;
      const note =
        midi > 0 ? pitchClassName(midi, namingRef.current) + noteOctave(midi) : '--';
      const rounded = Math.round(frame.cents);
      const centsLabel = !frame.hasSignal
        ? '--'
        : rounded === 0
          ? '0'
          : `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)}`;

      if (segmentFontReady()) {
        const style = { colour: hot, alpha, ghost: 0.045 + fade * 0.025 };

        // Long labels — "Sol♯" and an octave — would otherwise run off the sides.
        const fit = (text: string, size: number) => {
          const max = S * 0.8;
          const wanted = segmentWidth(ctx, text, size);
          return wanted > max ? (size * max) / wanted : size;
        };

        drawSegmentText(ctx, note, cx, cy - (1 - NOTE_Y) * S, fit(note, NOTE_SIZE * S), style);
        drawSegmentText(
          ctx,
          centsLabel,
          cx,
          cy - (1 - CENTS_Y) * S,
          fit(centsLabel, CENTS_SIZE * S),
          style,
        );
      }

      ctx.restore();
    },
  });

  return <canvas ref={canvasRef} className="field__canvas" aria-hidden />;
}
