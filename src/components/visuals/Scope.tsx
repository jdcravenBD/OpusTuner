import { useRef } from 'react';
import { triggerStart } from '../../audio/AudioEngine';
import { noteOctave, pitchClassName } from '../../music/notes';
import { tuner } from '../../tuner/TunerController';
import {
  clamp,
  colorFor,
  useVisualCanvas,
  visualFont,
  type VisualProps,
} from './shared';

/**
 * How much of the string the window holds, before it is rounded to a whole
 * number of cycles.
 *
 * A *time*, not a cycle count, and that is the one decision this screen turns
 * on. A window of N cycles slides at the beat rate divided by N, and the beat
 * rate is proportional to the frequency — so a fixed cycle count would make
 * the screen four times as twitchy on the high E as on the low one, for the
 * same error in cents. A fixed length of time cancels the frequency out
 * exactly: 25 cents slides the picture four tenths of its width every second
 * on every string of every instrument.
 *
 * Which means the cycle count varies instead, and visibly — three cycles on a
 * low E, thirteen on the high one. That is the screen telling you something
 * true about the string rather than a scale being wrenched about.
 */
const WINDOW_SECONDS = 0.04;
/**
 * Below about 60 Hz, forty milliseconds is less than two cycles and there is
 * no waveform left to recognise, so the bottom of a five-string bass buys its
 * legibility back with a longer window and a little less sensitivity. The
 * ceiling is the other end of the same argument: past thirty-two cycles the
 * page is a picket fence.
 */
const MIN_CYCLES = 2;
const MAX_CYCLES = 32;

/**
 * Points along the trace.
 *
 * Comfortably more than the pixels across a phone, so the curve is limited by
 * the screen rather than by this. Above the deepest bass the window is about
 * 1900 samples, so most of the time this is interpolating between samples
 * rather than skipping any.
 */
const POINTS = 384;

/**
 * Past traces kept behind the live one, and how often one is taken.
 *
 * Phosphor, and not only for the look of it. Four traces over a sixth of a
 * second means a drifting wave draws its own recent history as a smear, in
 * the direction it is going — so the screen answers "which way" in a glance
 * and in a still photograph, where a single trace answers it only if you
 * watch. In tune they land on each other and the trace is simply one clean
 * line, which is the cleanest possible statement of being in tune.
 */
const GHOSTS = 4;
const GHOST_HZ = 26;
const GHOST_ALPHA = 0.42;

/**
 * The trace is normalised, or a note would shrink to a flat line while it was
 * still perfectly tunable. Fast to catch a pluck, slow to let go, so a decay
 * shows as the trace easing down rather than as a gain pedal.
 *
 * MIN_PEAK is the floor that stops a quiet room being amplified into a
 * screenful of fuzz. It is a backstop rather than the main defence — the trace
 * is scaled by the signal fade as well, and that is what actually empties the
 * screen when a note ends.
 */
const PEAK_ATTACK = 0.4;
const PEAK_RELEASE = 0.012;
const MIN_PEAK = 0.01;
/** Room above the normalised height for the frame a pluck lands on. */
const CLIP = 1.3;

/* Layout, as fractions of the band the chassis has left. */
const BAND_Y = 0.47;
const BAND_HALF = 0.185;
const NOTE_Y = 0.215;
const NOTE_SIZE = 0.125;
const CENTS_Y = 0.8;
const CENTS_SIZE = 0.055;

/**
 * The scope.
 *
 * The string's own waveform, cut into lengths of the note you are tuning to.
 * Every frame opens its window on the same phase of the target — see
 * `triggerStart` in AudioEngine — so a string sounding exactly that frequency
 * draws the same picture every time and the wave sits perfectly still. Off
 * pitch it slides, one way for sharp and the other for flat, at exactly the
 * beat rate: one width of the screen every N seconds where N is the cycles on
 * show divided by the error in hertz.
 *
 * Nothing here is a rendering of the reading. The detector is not consulted
 * except to name the note, and the smoothing that keeps a needle steady is
 * nowhere near it. What moves is the string.
 *
 * ## The time axis runs right to left
 *
 * Deliberately, and it is the one liberty the screen takes. A window that is
 * running fast arrives early, so its features land nearer the start of the
 * buffer with every frame — a sharp string drifts toward index zero, which
 * drawn the ordinary way is leftward. Every other screen in this app puts
 * sharp to the right, and the ♭ and ♯ beside this one say so in as many
 * words.
 *
 * So the buffer is drawn from its end. What that costs is a waveform mirrored
 * in time, and it costs nothing else: a steady string is a sum of harmonics
 * at fixed relative phases, and there is no way to tell one of those from its
 * own reflection by looking. Nothing on screen claims a direction for time.
 * What it buys is the screen agreeing with the two either side of it.
 *
 * ## Why it takes the verdict colour when the strobe refuses it
 *
 * The strobe is the finest instrument here and a colour on it would tempt you
 * off the motion, which is the more precise of the two by a wide margin. This
 * screen is the middle one and the trade runs the other way: the slide is
 * continuous, so telling "very slow" from "stopped" takes a second or two of
 * watching, and the colour says the same thing as a threshold, instantly. The
 * ladder across the three screens is the point — position and colour, then
 * motion and colour, then motion alone.
 */
export function Scope({
  tolerance,
  themeKey,
  naming,
  fallbackMidi,
  marks,
  cents,
  padTop,
  padBottom,
}: VisualProps) {
  const live = useRef(new Float32Array(POINTS));
  const ghosts = useRef({
    data: Array.from({ length: GHOSTS }, () => new Float32Array(POINTS)),
    head: 0,
    count: 0,
    accum: 0,
    /** What the window was when they were taken; a change makes them nonsense. */
    cycles: 0,
  });
  const peak = useRef(0);
  const signalFade = useRef(0);

  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const namingRef = useRef(naming);
  namingRef.current = naming;
  const fallbackRef = useRef(fallbackMidi);
  fallbackRef.current = fallbackMidi;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const showCentsRef = useRef(cents);
  showCentsRef.current = cents;
  const padTopRef = useRef(padTop);
  padTopRef.current = padTop;
  const padBottomRef = useRef(padBottom);
  padBottomRef.current = padBottom;

  const canvasRef = useVisualCanvas({
    themeKey,
    draw: (ctx, size, p, frame, dt) => {
      const { w, h, dpr } = size;
      /*
       * The band the readings are laid out in. Zero pads everywhere but Full,
       * where the canvas is the whole app: the trace and the graticule still
       * run edge to edge, but the note and the cents sit inside what the
       * chassis has left. See padTop on VisualProps.
       */
      const top = padTopRef.current;
      const floorY = Math.max(top + 64, h - padBottomRef.current);
      const boxH = floorY - top;

      const engine = tuner.engine;
      const f0 = frame.targetFreq;
      /*
       * The reference tone shares the room with the string. The engine goes
       * deaf while one is playing and the ring goes on filling, so a scope
       * that ignored this would draw the app's own note — perfectly on target,
       * perfectly still, and a lie about the string.
       */
      const hearing = frame.hasSignal && !engine.deaf;
      signalFade.current += ((hearing ? 1 : 0) - signalFade.current) * 0.1;
      const fade = signalFade.current;

      const cycles = f0 > 0 ? clamp(Math.round(f0 * WINDOW_SECONDS), MIN_CYCLES, MAX_CYCLES) : 0;

      /* --- cut a window out of the string ------------------------------- */
      const buf = live.current;
      let got = false;
      if (cycles > 0 && engine.sampleRate > 0) {
        const period = engine.sampleRate / f0;
        const span = cycles * period;
        // Leave the trigger room to round down by a period and still sit
        // inside the ring; below the lowest string this is never close.
        if (span + period * 2 < engine.history) {
          const from = triggerStart(engine.clock, period, span);
          got = engine.readSpan(buf, from, span / (POINTS - 1));
        }
      }

      if (got) {
        /*
         * Centre it, then scale it.
         *
         * Taking the window's own mean out is a high-pass of the crudest kind
         * and belongs nowhere near the detector — a tuner that high-passes its
         * input throws away the fundamental of the string it is measuring.
         * Here it affects nothing but the picture, and without it a little
         * mains hum or handling rumble walks the whole trace off the top.
         */
        let sum = 0;
        for (let i = 0; i < POINTS; i++) sum += buf[i];
        const mean = sum / POINTS;
        let loudest = 0;
        for (let i = 0; i < POINTS; i++) {
          const v = buf[i] - mean;
          buf[i] = v;
          const a = v < 0 ? -v : v;
          if (a > loudest) loudest = a;
        }
        const was = peak.current;
        peak.current = was + (loudest - was) * (loudest > was ? PEAK_ATTACK : PEAK_RELEASE);
        const norm = Math.max(peak.current, MIN_PEAK);
        for (let i = 0; i < POINTS; i++) buf[i] = clamp(buf[i] / norm, -CLIP, CLIP);
      } else {
        buf.fill(0);
      }

      /* --- age the phosphor --------------------------------------------- */
      const g = ghosts.current;
      if (g.cycles !== cycles) {
        g.cycles = cycles;
        g.count = 0;
      }
      g.accum += dt;
      const interval = 1 / GHOST_HZ;
      if (g.accum >= interval) {
        g.accum %= interval;
        g.data[g.head].set(buf);
        g.head = (g.head + 1) % GHOSTS;
        if (g.count < GHOSTS) g.count++;
      }

      /* --- draw ---------------------------------------------------------- */
      const midY = top + boxH * BAND_Y;
      const half = boxH * BAND_HALF;
      const inTune = hearing && Math.abs(frame.cents) <= toleranceRef.current;
      const hot = colorFor(p, hearing ? frame.cents : 9999, toleranceRef.current);
      const alpha = 0.32 + fade * 0.68;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      /*
       * The graticule, and it is furniture rather than scale — which is why
       * `marks` takes all of it and leaves the field's gridlines alone. On the
       * field the reading is a position and the gridlines are the only thing
       * that makes a position mean anything. Here the reading is motion, and
       * motion is legible against the trace's own shape. The rules make it
       * easier; nothing depends on them.
       */
      if (marksRef.current && cycles > 0) {
        ctx.strokeStyle = p.tick;
        ctx.lineWidth = 1;
        // Faded off as the cycles crowd together, so the high strings do not
        // draw a picket fence behind their own wave.
        ctx.globalAlpha = 0.17 * clamp(9 / cycles, 0.28, 1);
        for (let c = 1; c < cycles; c++) {
          const x = Math.round((w * c) / cycles) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.11;
        for (const s of [-1, 1]) {
          const y = Math.round(midY + s * half) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }

      // Zero. The one rule that stays, and it greens with the verdict exactly
      // as the field's centre line does.
      ctx.globalAlpha = inTune ? 0.55 : 0.3;
      ctx.strokeStyle = inTune ? p.green : p.tick;
      ctx.lineWidth = inTune ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(midY) + 0.5);
      ctx.lineTo(w, Math.round(midY) + 0.5);
      ctx.stroke();

      /*
       * Right to left — see the note at the top. The two ends of the buffer
       * are a whole number of target cycles apart, so on a string that is in
       * tune they carry the same phase and the trace meets itself across the
       * screen's edges.
       */
      const amp = half * fade;
      const stroke = (v: Float32Array, width: number, a: number) => {
        ctx.globalAlpha = a;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < POINTS; i++) {
          const x = w - (i * w) / (POINTS - 1);
          const y = midY - v[i] * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = hot;

      // Oldest first, so the live trace lands on top of its own history.
      for (let k = 0; k < g.count; k++) {
        const idx = (g.head - g.count + k + GHOSTS * 2) % GHOSTS;
        const age = (g.count - k) / (GHOSTS + 1);
        stroke(g.data[idx], 1.2, alpha * GHOST_ALPHA * (1 - age));
      }

      /*
       * A wide faint pass under a narrow solid one, rather than a shadowBlur.
       * Blurring a path of several hundred segments is the one thing on these
       * screens that has ever cost a frame on a handset, and two strokes look
       * the same from more than a foot away.
       */
      stroke(buf, inTune ? 7 : 5, alpha * 0.13);
      stroke(buf, 2, alpha);

      /* --- the readout, above and below the wave ------------------------- */
      const midi = frame.targetMidi > 0 ? frame.targetMidi : fallbackRef.current;
      ctx.fillStyle = hot;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // The note the window is cut to, which is the whole premise of the
      // screen. A reading, not furniture — it stays when the marks go, the
      // same way the strobe's does.
      if (midi > 0) {
        ctx.globalAlpha = alpha * 0.92;
        ctx.font = visualFont(Math.max(15, Math.round(boxH * NOTE_SIZE)));
        ctx.fillText(
          pitchClassName(midi, namingRef.current) + noteOctave(midi),
          w / 2,
          top + boxH * NOTE_Y,
        );
      }

      if (hearing && showCentsRef.current) {
        const rounded = Math.round(frame.cents);
        const label = rounded === 0 ? '0' : `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)}`;
        ctx.globalAlpha = alpha * 0.85;
        ctx.font = visualFont(Math.max(11, Math.round(boxH * CENTS_SIZE)));
        ctx.fillText(label, w / 2, top + boxH * CENTS_Y);
      }

      ctx.restore();
    },
  });

  return <canvas ref={canvasRef} className="field__canvas" aria-hidden />;
}
