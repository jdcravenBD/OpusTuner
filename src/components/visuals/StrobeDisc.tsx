import { useRef } from 'react';
import { clamp, colourFor, useVisualCanvas, visualFont, type VisualProps } from './shared';

/**
 * Segment counts per band, innermost first. Rising counts on the faster bands
 * is what gives the outer rings their finer resolution.
 */
const BANDS = [
  { segments: 8, speed: 1, inner: 0.34, outer: 0.5 },
  { segments: 12, speed: 2, inner: 0.55, outer: 0.71 },
  { segments: 18, speed: 4, inner: 0.76, outer: 0.94 },
];

/**
 * Base drift, in revolutions per second per cent of error, and its ceiling.
 *
 * A true strobe drifts at the beat frequency, which at a hundred cents out is
 * several revolutions a second and reads as a grey blur. Compressing it keeps
 * the bands legible across the whole range while preserving the only thing that
 * matters: which way, and how fast.
 */
const REV_PER_CENT = 1 / 40;
const MAX_REV = 1.2;

/**
 * The strobe.
 *
 * Bands of segments that drift left when you are flat and right when you are
 * sharp, and stop dead when you are not. Nothing to read and no needle to
 * settle — motion against stillness is about the most sensitive thing human
 * vision does, which is why the mechanical original is still the reference
 * instrument. Each band runs at twice the one inside it, so the outer ring is
 * still visibly creeping when the inner one has already stopped.
 */
export function StrobeDisc({ tolerance, themeKey }: VisualProps) {
  const phase = useRef(0);
  const displayCents = useRef(0);
  const signalFade = useRef(0);

  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;

  const canvasRef = useVisualCanvas({
    themeKey,
    draw: (ctx, size, p, frame, dt) => {
      const { w, h, dpr } = size;
      const tolerance = toleranceRef.current;

      const target = frame.hasSignal ? frame.cents : 0;
      displayCents.current += (target - displayCents.current) * 0.18;
      signalFade.current += ((frame.hasSignal ? 1 : 0) - signalFade.current) * 0.1;

      const rev = clamp(displayCents.current * REV_PER_CENT, -MAX_REV, MAX_REV);
      phase.current += rev * dt * Math.PI * 2;
      // Kept bounded: after a long session an unwrapped angle loses enough
      // float precision to make the slow bands visibly step.
      phase.current %= Math.PI * 2;

      const fade = signalFade.current;
      const alpha = 0.3 + fade * 0.7;
      const inTune = frame.hasSignal && Math.abs(frame.cents) <= tolerance;
      const hot = colourFor(p, frame.hasSignal ? frame.cents : 9999, tolerance);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) / 2;

      /* --- band tracks --------------------------------------------------- */
      for (const band of BANDS) {
        ctx.globalAlpha = 0.1;
        ctx.strokeStyle = p.tick;
        ctx.lineWidth = (band.outer - band.inner) * R;
        ctx.beginPath();
        ctx.arc(cx, cy, ((band.inner + band.outer) / 2) * R, 0, Math.PI * 2);
        ctx.stroke();
      }

      /* --- the segments -------------------------------------------------- */
      for (const band of BANDS) {
        const step = (Math.PI * 2) / band.segments;
        // Half-lit, half-dark: the highest contrast a drifting pattern can have.
        const arcSpan = step * 0.5;
        const bandPhase = phase.current * band.speed;
        ctx.globalAlpha = alpha * (inTune ? 0.95 : 0.78);
        ctx.strokeStyle = hot;
        ctx.lineWidth = (band.outer - band.inner) * R;
        const r = ((band.inner + band.outer) / 2) * R;
        for (let i = 0; i < band.segments; i++) {
          const a0 = bandPhase + i * step;
          ctx.beginPath();
          ctx.arc(cx, cy, r, a0, a0 + arcSpan);
          ctx.stroke();
        }
      }

      /* --- index mark at twelve o'clock ----------------------------------- */
      // A stationary reference. Without it the bands have nothing to be still
      // against, and "barely creeping" looks the same as "stopped".
      ctx.globalAlpha = inTune ? 0.9 : 0.4;
      ctx.strokeStyle = inTune ? p.green : p.tick;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - R * 0.96);
      ctx.lineTo(cx, cy - R * 0.3);
      ctx.stroke();

      /* --- centre well ---------------------------------------------------- */
      const wellR = R * 0.3;
      const well = ctx.createRadialGradient(cx, cy - wellR * 0.4, 0, cx, cy, wellR);
      well.addColorStop(0, 'rgba(0,0,0,0.55)');
      well.addColorStop(1, 'rgba(0,0,0,0.8)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = well;
      ctx.beginPath();
      ctx.arc(cx, cy, wellR, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = inTune ? 0.8 : 0.3;
      ctx.strokeStyle = inTune ? p.green : p.tick;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, wellR, 0, Math.PI * 2);
      ctx.stroke();

      if (frame.hasSignal) {
        const cents = Math.round(frame.cents);
        const label = cents === 0 ? '0' : `${cents > 0 ? '+' : '-'}${Math.abs(cents)}`;
        ctx.font = visualFont(Math.max(14, Math.round(R * 0.3)));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = hot;
        ctx.fillText(label, cx, cy + R * 0.012);
      }

      ctx.restore();
    },
  });

  return <canvas ref={canvasRef} className="field__canvas" aria-hidden />;
}
