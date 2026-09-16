import { useRef } from 'react';
import { noteOctave, pitchClassName } from '../../music/notes';
import { drawSegmentText, loadSegmentFont, segmentWidth } from './segments';
import { clamp, colorFor, useVisualCanvas, visualFont, type VisualProps } from './shared';

/**
 * The bottom and top of the axis, in Hz.
 *
 * A1 to a little past C8: six and a quarter octaves, which covers every
 * fundamental the app will tune (a five-string bass starts at 31 Hz — see
 * below) and the first several harmonics of all of them. Past 4 kHz a guitar
 * has nothing but string noise, and drawing it would spend a third of the
 * width on hiss.
 */
const F_MIN = 55;
const F_MAX = 4200;

/** Where the spectrum's own area starts, as a fraction down the screen. */
const PLOT_TOP = 0.34;
/** Padding either side, so a peak at the very bottom of the range has room. */
const PAD_FRAC = 0.045;

/**
 * How far below the loudest thing on screen the floor sits.
 *
 * Wide enough that the eighth harmonic of a plucked string is still visible —
 * a sawtooth's is 18 dB down and a real string's rather less — and narrow
 * enough that the noise between the partials stays on the floor where it
 * belongs rather than filling the gaps in.
 */
const DB_FLOOR = -46;

/**
 * Room kept under the plot for the screen's own corner print.
 *
 * The axis labels and "SPECTRUM - 55 - 4k Hz" both want the bottom-left, and
 * the print is furniture the whole app shares rather than something this
 * screen may move.
 */
const FOOT = 15;

/** Harmonics marked against the target, past which the axis runs out anyway. */
const MARK_HARMONICS = 10;

/**
 * Where the faint vertical rules sit, and they are not labelled.
 *
 * They were, and the numbers were the wrong annotation twice over: the two at
 * the low end land on top of the screen's own corner print, and a musician
 * reading a harmonic series does not want to be told it starts at 82.4 Hz.
 * The range is in the corner print already; these are here to give the axis a
 * sense of scale, which they do without saying anything.
 */
const AXIS_HZ = [100, 200, 500, 1000, 2000, 4000];

/** Closest two harmonic numbers may sit before the later one is dropped. */
const LABEL_GAP = 11;

/**
 * How the curve settles: quick to rise, slow to fall.
 *
 * A spectrum at sixty frames a second is a shivering thing, and drawn raw it
 * reads as noise however accurate it is. Asymmetric smoothing per column is
 * what a spectrum analyser has always done — the attack keeps a pluck's
 * transient, and the release is what leaves a legible shape behind it.
 */
const RISE = 0.55;
const FALL = 0.11;

/** The peak the scale is normalised against, tracked the same way. */
const PEAK_RISE = 0.5;
const PEAK_FALL = 0.02;

/**
 * The spectrum.
 *
 * The other two screens answer "how far off is it", twice, in two languages.
 * This one answers something neither can: *what* is sounding. How many
 * harmonics the string is giving you and how strong they are, which is the
 * difference between a live string and a dead one, and between picking over
 * the neck and picking at the bridge. Anything else in the room that is
 * ringing shows up here as a peak that belongs to nothing.
 *
 * **It is not a second opinion on the pitch, and cannot be.** Six and a
 * quarter octaves across a phone is about 45 pixels to the octave, so thirty
 * cents is one pixel: a partial running sharp of its mark is real and is
 * invisible at this scale. What the marks are for is coarser and more useful
 * -- they say which peak the detector is aiming at. If the tall one is not on
 * the fundamental's mark, you are looking at an octave error or at a
 * neighbouring string that is louder than the one you meant to play, and
 * neither of those is visible anywhere else in the app.
 *
 * (Showing the fine deviation would take a different screen: the harmonics on
 * a cents scale rather than a frequency one, one row each. That is a fourth
 * screen, not a change to this one.)
 *
 * Log frequency, because music is: an octave is the same distance wherever it
 * sits, so a harmonic series is a shape you learn to recognise rather than a
 * set of numbers that crowd together at the top.
 */
export function SpectrumView({
  themeKey,
  naming,
  fallbackMidi,
  tolerance,
  marks,
  cents,
  padTop,
  padBottom,
}: VisualProps) {
  /** One smoothed magnitude per column of pixels, rebuilt on resize. */
  const cols = useRef<Float32Array | null>(null);
  const peak = useRef(0);
  const signalFade = useRef(0);

  const namingRef = useRef(naming);
  namingRef.current = naming;
  const fallbackRef = useRef(fallbackMidi);
  fallbackRef.current = fallbackMidi;
  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const centsRef = useRef(cents);
  centsRef.current = cents;
  const padRef = useRef({ top: padTop, bottom: padBottom });
  padRef.current = { top: padTop, bottom: padBottom };

  loadSegmentFont();

  const canvasRef = useVisualCanvas({
    themeKey,
    onResize: () => {
      cols.current = null;
    },
    draw: (ctx, size, p, frame) => {
      const { w, h, dpr } = size;

      /* The band the screen is allowed to use — see padTop on VisualProps. */
      const top = padRef.current.top;
      const floorY = Math.max(top + 64, h - padRef.current.bottom);
      const boxH = floorY - top;

      const pad = Math.min(24, w * PAD_FRAC * 2);
      const plotL = pad;
      const plotR = w - pad;
      const plotW = Math.max(1, plotR - plotL);
      const plotT = top + boxH * PLOT_TOP;
      const plotB = floorY - FOOT;
      const plotH = Math.max(1, plotB - plotT);

      /** Where a frequency sits across the plot. Log, so octaves are even. */
      const logMin = Math.log(F_MIN);
      const span = Math.log(F_MAX) - logMin;
      const xOf = (hz: number) => plotL + ((Math.log(hz) - logMin) / span) * plotW;

      const n = Math.max(1, Math.round(plotW));
      if (!cols.current || cols.current.length !== n) cols.current = new Float32Array(n);
      const col = cols.current;

      signalFade.current += ((frame.hasSignal ? 1 : 0) - signalFade.current) * 0.1;
      const fade = signalFade.current;
      const alpha = 0.32 + fade * 0.68;

      /* --- read the spectrum into columns -------------------------------- */
      /*
       * Every column takes the loudest bin that falls in it, which is the only
       * honest reduction: a peak that lands between two columns has to survive
       * as a peak, and averaging would file it down. At the bottom of the axis
       * the opposite happens — one bin covers several columns, because 5.4 Hz
       * of resolution is a third of a semitone down there — so the low end is
       * drawn in steps and cannot be anything else without inventing detail.
       */
      const spec = frame.spectrum;
      const binHz = frame.spectrumBinHz;
      const fresh = new Float32Array(n);
      if (spec && binHz > 0) {
        const kMin = Math.max(1, Math.floor(F_MIN / binHz));
        const kMax = Math.min(spec.length - 1, Math.ceil(F_MAX / binHz));
        for (let k = kMin; k <= kMax; k++) {
          const i = Math.round(xOf(k * binHz) - plotL);
          if (i < 0 || i >= n) continue;
          if (spec[k] > fresh[i]) fresh[i] = spec[k];
        }
        /*
         * Gaps, filled from the left. Above about 700 Hz a column can fall
         * between two bins and be left at nothing, which draws as a comb of
         * hairline notches through an otherwise solid curve.
         */
        for (let i = 1; i < n; i++) if (fresh[i] === 0) fresh[i] = fresh[i - 1];
      }

      let frameMax = 0;
      for (let i = 0; i < n; i++) if (fresh[i] > frameMax) frameMax = fresh[i];
      peak.current +=
        (frameMax - peak.current) * (frameMax > peak.current ? PEAK_RISE : PEAK_FALL);
      const ref = Math.max(peak.current, 1e-9);

      for (let i = 0; i < n; i++) {
        /*
         * Three columns wide, and it is not decoration.
         *
         * The detector windows its input with a rectangle -- it zero-pads and
         * transforms, because that is what a linear autocorrelation wants --
         * and a rectangular window leaks: every partial arrives with sidelobes
         * that fill the valleys either side of it. Drawn column by column that
         * reads as a comb of noise rather than as a harmonic series. Widening
         * a peak by a pixel to bury its own sidelobes is the honest trade,
         * and the alternative -- windowing before the transform -- is a change
         * to the detector for the sake of a picture, which it will not have.
         */
        const smoothed = (fresh[Math.max(0, i - 1)] + fresh[i] * 2 + fresh[Math.min(n - 1, i + 1)]) / 4;
        // 10log10 because these are powers, not amplitudes.
        const db = 10 * Math.log10(Math.max(smoothed, 1e-12) / ref);
        const v = clamp(1 - db / DB_FLOOR, 0, 1);
        col[i] += (v - col[i]) * (v > col[i] ? RISE : FALL);
      }

      /* --- paint ---------------------------------------------------------- */
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const inTune = frame.hasSignal && Math.abs(frame.cents) <= toleranceRef.current;
      const hot = colorFor(p, frame.hasSignal ? frame.cents : 9999, toleranceRef.current);

      /* Frequency rules. */
      if (marksRef.current) {
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = p.tick;
        ctx.lineWidth = 1;
        for (const hz of AXIS_HZ) {
          const x = xOf(hz);
          if (x < plotL || x > plotR) continue;
          ctx.beginPath();
          ctx.moveTo(x, plotT);
          ctx.lineTo(x, plotB);
          ctx.stroke();
        }
      }

      /*
       * The harmonic series of the *target*, not of what is sounding.
       *
       * These are the marks a perfectly harmonic string would land its
       * partials on, which is the comparison worth drawing: the peaks are
       * yours and the ticks are the arithmetic. The fundamental takes the
       * in-tune colour, so the one mark you are actually tuning to answers
       * the same question the rest of the app does.
       */
      const targetF = frame.targetFreq > 0 ? frame.targetFreq : 0;
      if (targetF > 0) {
        let lastLabel = -Infinity;
        for (let k = 1; k <= MARK_HARMONICS; k++) {
          const hz = targetF * k;
          if (hz > F_MAX) break;
          const x = xOf(hz);
          if (x < plotL) continue;
          const first = k === 1;
          ctx.globalAlpha = first ? (inTune ? 0.85 : 0.5) * alpha : 0.3 * alpha;
          ctx.strokeStyle = first ? hot : p.tick;
          ctx.lineWidth = first ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(x, plotT);
          ctx.lineTo(x, plotB);
          ctx.stroke();
          /*
           * Numbered while there is room to number it. A log axis crowds the
           * upper harmonics together -- six through ten of a low E sit inside
           * thirty pixels -- and five digits touching each other say less than
           * the two that fit.
           */
          if (marksRef.current && !first && x - lastLabel >= LABEL_GAP) {
            lastLabel = x;
            ctx.globalAlpha = 0.34 * alpha;
            ctx.fillStyle = p.text3;
            ctx.font = visualFont(Math.max(8, Math.round(boxH * 0.028)));
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(String(k), x, plotT + 2);
          }
        }
      }

      /* The curve, filled from the floor and stroked along the top. */
      ctx.beginPath();
      ctx.moveTo(plotL, plotB);
      for (let i = 0; i < n; i++) ctx.lineTo(plotL + i, plotB - col[i] * plotH);
      ctx.lineTo(plotL + n - 1, plotB);
      ctx.closePath();

      /*
       * The curve is neutral and only the marks take the colour.
       *
       * Everywhere else in the app the hot colour is a verdict -- green means
       * arrived, amber means a neighbour is nearer. The curve is not a
       * verdict, it is what you played, and a screen-wide shape that turned
       * green would be the loudest possible way of saying something the one
       * tick mark beside it already says.
       */
      const grad = ctx.createLinearGradient(0, plotT, 0, plotB);
      grad.addColorStop(0, p.tickHot);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha * 0.14;
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = p.tickHot;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const y = plotB - col[i] * plotH;
        if (i === 0) ctx.moveTo(plotL, y);
        else ctx.lineTo(plotL + i, y);
      }
      ctx.stroke();

      /* --- the readout, above the plot ------------------------------------ */
      const midi = frame.targetMidi > 0 ? frame.targetMidi : fallbackRef.current;
      const note =
        midi > 0 ? pitchClassName(midi, namingRef.current) + noteOctave(midi) : '--';
      const rounded = Math.round(frame.cents);
      const centsLabel = !frame.hasSignal
        ? '--'
        : rounded === 0
          ? '0'
          : `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)}`;

      const style = { color: hot, alpha, ghost: 0.045 + fade * 0.025 };
      const unit = Math.min(w, boxH);
      const fit = (text: string, px: number) => {
        const max = w * 0.72;
        const wanted = segmentWidth(ctx, text, px);
        return wanted > max ? (px * max) / wanted : px;
      };

      const noteSize = unit * 0.2;
      drawSegmentText(ctx, note, w / 2, top + boxH * 0.19, fit(note, noteSize), style);
      if (centsRef.current) {
        const centsSize = unit * 0.115;
        drawSegmentText(
          ctx,
          centsLabel,
          w / 2,
          top + boxH * 0.295,
          fit(centsLabel, centsSize),
          style,
        );
      }

      ctx.restore();
    },
  });

  return <canvas ref={canvasRef} className="field__canvas" aria-hidden />;
}
