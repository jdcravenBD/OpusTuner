import { useRef } from 'react';
import { useTunerFrame } from '../hooks';
import { ArrowDownIcon, ArrowUpIcon } from './Icons';
import { formatHz, noteOctave, pitchClassName, type NoteNaming } from '../music/notes';

interface Props {
  naming: NoteNaming;
  tolerance: number;
  /** Note to centre the carousel on before anything has been detected. */
  fallbackMidi: number;
}

/** Chromatic offsets shown either side of the focused note. */
const NEIGHBOURS = [-2, -1, 1, 2] as const;

/**
 * The note carousel and the flat/sharp verdict.
 *
 * The focused note sits in the middle at full size, with its two chromatic
 * neighbours either side shrinking and dimming outward. It is a readout, not a
 * control — nothing here is interactive.
 *
 * Every value changes on nearly every animation frame, so the component writes
 * to the DOM through refs instead of setting state. React renders this once and
 * then stays out of the way.
 */
export function NoteDisplay({ naming, tolerance, fallbackMidi }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const octaveRef = useRef<HTMLSpanElement>(null);
  const neighbourRefs = useRef<Array<HTMLSpanElement | null>>([null, null, null, null]);
  const verdictRef = useRef<HTMLDivElement>(null);
  const centsRef = useRef<HTMLSpanElement>(null);
  const upRef = useRef<HTMLSpanElement>(null);
  const downRef = useRef<HTMLSpanElement>(null);

  const namingRef = useRef(naming);
  namingRef.current = naming;
  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const fallbackRef = useRef(fallbackMidi);
  fallbackRef.current = fallbackMidi;

  // Last written values — avoids touching the DOM when nothing changed.
  const prev = useRef({
    midi: -1,
    verdict: '',
    state: '',
    signal: '',
    intune: '',
    naming: '' as string,
  });

  useTunerFrame((frame) => {
    const p = prev.current;
    const hasNote = frame.targetMidi > 0;
    const centre = hasNote ? frame.targetMidi : fallbackRef.current;

    // The whole carousel is rewritten only when the focused note (or the
    // accidental style) actually changes — typically a few times a session.
    if (centre !== p.midi || namingRef.current !== p.naming) {
      p.midi = centre;
      p.naming = namingRef.current;
      const valid = centre > 0;
      if (nameRef.current) {
        nameRef.current.textContent = valid
          ? pitchClassName(centre, namingRef.current)
          : '–';
      }
      if (octaveRef.current) {
        octaveRef.current.textContent = valid ? String(noteOctave(centre)) : '';
      }
      NEIGHBOURS.forEach((offset, i) => {
        const el = neighbourRefs.current[i];
        if (!el) return;
        el.textContent = valid ? pitchClassName(centre + offset, namingRef.current) : '';
      });
    }

    const inTune = frame.hasSignal && Math.abs(frame.cents) <= toleranceRef.current;
    const signal = String(frame.hasSignal);
    if (signal !== p.signal) {
      p.signal = signal;
      wrapRef.current?.setAttribute('data-signal', signal);
    }
    const intuneAttr = String(inTune);
    if (intuneAttr !== p.intune) {
      p.intune = intuneAttr;
      wrapRef.current?.setAttribute('data-intune', intuneAttr);
    }

    let state: string;
    let text: string;
    if (!frame.hasSignal) {
      state = 'idle';
      text = hasNote ? 'Play again' : 'Play a note';
    } else if (inTune) {
      state = 'intune';
      text = 'In tune';
    } else if (frame.cents < 0) {
      state = 'flat';
      text = `${Math.round(Math.abs(frame.cents))}¢ flat`;
    } else {
      state = 'sharp';
      text = `${Math.round(frame.cents)}¢ sharp`;
    }

    if (state !== p.state) {
      p.state = state;
      verdictRef.current?.setAttribute('data-state', state);
      // Arrow points the way the peg should go: flat means wind it up.
      if (upRef.current) upRef.current.style.display = state === 'flat' ? 'flex' : 'none';
      if (downRef.current) downRef.current.style.display = state === 'sharp' ? 'flex' : 'none';
    }
    if (text !== p.verdict) {
      p.verdict = text;
      if (centsRef.current) centsRef.current.textContent = text;
    }
  });

  return (
    <div className="note-block">
      <div
        className="carousel"
        ref={wrapRef}
        data-signal="false"
        data-intune="false"
        aria-hidden
      >
        {NEIGHBOURS.slice(0, 2).map((offset, i) => (
          <span
            key={offset}
            className="carousel__note"
            data-dist={Math.abs(offset)}
            ref={(el) => {
              neighbourRefs.current[i] = el;
            }}
          />
        ))}
        <span className="carousel__note carousel__note--focus">
          <span ref={nameRef}>–</span>
          <span className="carousel__octave" ref={octaveRef} />
        </span>
        {NEIGHBOURS.slice(2).map((offset, i) => (
          <span
            key={offset}
            className="carousel__note"
            data-dist={Math.abs(offset)}
            ref={(el) => {
              neighbourRefs.current[i + 2] = el;
            }}
          />
        ))}
      </div>
      <div className="verdict" ref={verdictRef} data-state="idle" aria-live="polite">
        <span ref={upRef} style={{ display: 'none', alignItems: 'center' }}>
          <ArrowUpIcon />
        </span>
        <span ref={downRef} style={{ display: 'none', alignItems: 'center' }}>
          <ArrowDownIcon />
        </span>
        <span className="verdict__cents" ref={centsRef}>
          Play a note
        </span>
      </div>
    </div>
  );
}

/** Detected vs. target frequency, under the dial. */
export function Readout({ show }: { show: boolean }) {
  const detectedRef = useRef<HTMLElement>(null);
  const targetRef = useRef<HTMLElement>(null);
  const prev = useRef({ detected: '', target: '' });

  useTunerFrame((frame) => {
    const detected = frame.hasSignal && frame.frequency > 0 ? formatHz(frame.frequency) : '—';
    if (detected !== prev.current.detected) {
      prev.current.detected = detected;
      if (detectedRef.current) detectedRef.current.textContent = detected;
    }
    const target = frame.targetFreq > 0 ? formatHz(frame.targetFreq) : '—';
    if (target !== prev.current.target) {
      prev.current.target = target;
      if (targetRef.current) targetRef.current.textContent = target;
    }
  });

  if (!show) return null;

  return (
    <div className="readout">
      <span className="pill">
        Detected <b ref={detectedRef}>—</b> Hz
      </span>
      <span className="pill pill--ghost">
        Target <b ref={targetRef}>—</b> Hz
      </span>
    </div>
  );
}

