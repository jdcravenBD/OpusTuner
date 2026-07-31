import { useRef } from 'react';
import { pitchClassName } from '../../music/notes';
import {
  clamp,
  colourFor,
  useVisualCanvas,
  visualFont,
  type VisualProps,
} from './shared';

/**
 * Full-scale deflection, in cents.
 *
 * Deliberately a twentieth of the field's ±250. The field's job is to show you
 * where you are when you have no idea; this one's job is the last few cents,
 * and a needle that spends its whole life within two degrees of centre is no
 * use for that. Past full scale the needle pins and the over-range arrow lights,
 * which is the honest thing for an analogue movement to do.
 */
const RANGE_CENTS = 50;

/*
 * Arc geometry, as fractions of the square's side. These three are one answer,
 * not three choices: they are the circle through an apex at (0.50, 0.06) and
 * ends at (0.06, 0.30) and (0.94, 0.30), which is the largest arc that fills
 * the width and still has both needle tips land *inside* the screen at full
 * deflection. Move any one of them and the needle starts being clipped by the
 * sides, which is not obvious until you drive it to the end of the scale.
 */
/** Pivot height, from the top. */
const PIVOT_Y = 0.583;
/** Arc radius. */
const ARC_R = 0.523;
/** Half the sweep, in radians either side of vertical — asin(0.44 / ARC_R). */
const HALF_SWEEP = 0.9979;

/** Ticks every this many cents; every fifth is a major. */
const TICK_CENTS = 5;

/**
 * The needle.
 *
 * A moving-coil meter: a swept scale, a long thin pointer on a pivot near the
 * bottom, and enough mechanical inertia that it settles rather than snaps. Fine
 * scale, so the last few cents are a movement you can see rather than a number
 * you have to read.
 */
export function ArcMeter({ tolerance, themeKey, naming, fallbackMidi }: VisualProps) {
  const angle = useRef(0);
  const velocity = useRef(0);
  const signalFade = useRef(0);

  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const namingRef = useRef(naming);
  namingRef.current = naming;
  const fallbackRef = useRef(fallbackMidi);
  fallbackRef.current = fallbackMidi;

  const canvasRef = useVisualCanvas({
    themeKey,
    draw: (ctx, size, p, frame, dt) => {
      const { w, h, dpr } = size;
      const tolerance = toleranceRef.current;

      /* --- movement -------------------------------------------------------
       * A real meter needle is a mass on a spring with a damper across it, and
       * a critically damped one is what stops a tuner needle either jittering
       * or overshooting. Integrating that costs four lines and reads far better
       * than an exponential glide, which always looks like it is being dragged.
       */
      const targetAngle =
        (clamp(frame.cents, -RANGE_CENTS * 1.06, RANGE_CENTS * 1.06) / RANGE_CENTS) * HALF_SWEEP;
      const stiffness = 220;
      const damping = 2 * Math.sqrt(stiffness); // critical
      const step = Math.min(dt, 1 / 50);
      velocity.current += (targetAngle - angle.current) * stiffness * step;
      velocity.current -= velocity.current * damping * step;
      angle.current += velocity.current * step;

      signalFade.current += ((frame.hasSignal ? 1 : 0) - signalFade.current) * 0.1;
      const fade = signalFade.current;
      const alpha = 0.32 + fade * 0.68;

      const inTune = frame.hasSignal && Math.abs(frame.cents) <= tolerance;
      const hot = colourFor(p, frame.hasSignal ? frame.cents : 9999, tolerance);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const S = Math.min(w, h);
      const cx = w / 2;
      const cy = h / 2 + (PIVOT_Y - 0.5) * S;
      const R = S * ARC_R;

      const at = (a: number, r: number): [number, number] => [
        cx + Math.sin(a) * r,
        cy - Math.cos(a) * r,
      ];

      /* --- scale arc -------------------------------------------------- */
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = p.tick;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2 - HALF_SWEEP, -Math.PI / 2 + HALF_SWEEP);
      ctx.stroke();

      /* --- in-tune band ------------------------------------------------ */
      const tolAngle = (tolerance / RANGE_CENTS) * HALF_SWEEP;
      ctx.globalAlpha = inTune ? 0.34 : 0.13;
      ctx.strokeStyle = p.green;
      ctx.lineWidth = R * 0.075;
      ctx.beginPath();
      ctx.arc(cx, cy, R - ctx.lineWidth / 2, -Math.PI / 2 - tolAngle, -Math.PI / 2 + tolAngle);
      ctx.stroke();

      /* --- ticks -------------------------------------------------------- */
      for (let c = -RANGE_CENTS; c <= RANGE_CENTS; c += TICK_CENTS) {
        const major = c % 25 === 0;
        const a = (c / RANGE_CENTS) * HALF_SWEEP;
        const inner = R - (major ? R * 0.115 : R * 0.062);
        const [x1, y1] = at(a, inner);
        const [x2, y2] = at(a, R);
        ctx.globalAlpha = major ? 0.65 : 0.3;
        ctx.strokeStyle = c === 0 ? p.green : p.tick;
        ctx.lineWidth = major ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      /* --- scale numbers ------------------------------------------------ */
      ctx.font = visualFont(Math.max(9, Math.round(S * 0.038)));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.text3;
      for (const c of [-50, -25, 25, 50]) {
        const [x, y] = at((c / RANGE_CENTS) * HALF_SWEEP, R - R * 0.185);
        ctx.globalAlpha = 0.55;
        ctx.fillText(c > 0 ? `+${c}` : String(c), x, y);
      }

      /* --- the notes either side, on the shoulders ---------------------- */
      // Same idea as the field's gridline labels: a semitone out is a *note*,
      // not an abstract number, and naming it is what makes the scale readable
      // when you are nowhere near.
      const refMidi = frame.targetMidi > 0 ? frame.targetMidi : fallbackRef.current;
      if (refMidi > 0) {
        ctx.font = visualFont(Math.max(11, Math.round(S * 0.05)));
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = p.text3;
        const [lx, ly] = at(-HALF_SWEEP * 1.02, R - R * 0.35);
        const [rx, ry] = at(HALF_SWEEP * 1.02, R - R * 0.35);
        ctx.fillText(pitchClassName(refMidi - 1, namingRef.current), lx, ly);
        ctx.fillText(pitchClassName(refMidi + 1, namingRef.current), rx, ry);
      }

      /* --- over-range arrows -------------------------------------------- */
      // The needle has pinned; say which way it went, or the reading silently
      // lies about being merely 50 cents out.
      const over = frame.hasSignal && Math.abs(frame.cents) > RANGE_CENTS;
      if (over) {
        const dir = Math.sign(frame.cents);
        const [ax, ay] = at(dir * HALF_SWEEP * 0.99, R - R * 0.055);
        ctx.globalAlpha = alpha * (0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 260)));
        ctx.fillStyle = p.amber;
        ctx.beginPath();
        ctx.arc(ax, ay, Math.max(3, R * 0.028), 0, Math.PI * 2);
        ctx.fill();
      }

      /* --- the needle ---------------------------------------------------- */
      const a = clamp(angle.current, -HALF_SWEEP, HALF_SWEEP);
      const tipR = R - R * 0.03;
      const tailR = -R * 0.11; // counterweight, through the pivot
      const [tx, ty] = at(a, tipR);
      const [bx, by] = at(a, tailR);
      const halfWidth = Math.max(1.6, R * 0.016);
      // Perpendicular to the needle, so the taper is a real wedge rather than
      // a stroke that fattens as the needle leaves vertical.
      const px = Math.cos(a) * halfWidth;
      const py = Math.sin(a) * halfWidth;

      ctx.globalAlpha = alpha;
      ctx.shadowColor = hot;
      ctx.shadowBlur = inTune ? 20 : 10;
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx + px, by + py);
      ctx.lineTo(bx - px, by - py);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      /* --- pivot boss ---------------------------------------------------- */
      const boss = Math.max(5, R * 0.055);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.arc(cx, cy, boss, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, boss * 0.42, 0, Math.PI * 2);
      ctx.fill();

      /* --- cent readout, in the well below the pivot ---------------------- */
      if (frame.hasSignal) {
        const cents = Math.round(frame.cents);
        const label = cents === 0 ? '0' : `${cents > 0 ? '+' : '-'}${Math.abs(cents)}`;
        ctx.font = visualFont(Math.max(15, Math.round(S * 0.1)));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = hot;
        ctx.fillText(label, cx, cy + R * 0.5);
      }

      ctx.restore();
    },
  });

  return <canvas ref={canvasRef} className="field__canvas" aria-hidden />;
}
