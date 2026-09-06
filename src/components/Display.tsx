import { useRef } from 'react';
import { useTunerFrame } from '../hooks';
import { noteOctave, pitchClassName, type NoteNaming } from '../music/notes';

interface Props {
  naming: NoteNaming;
  tolerance: number;
  /** Note to centre the carousel on before anything has been detected. */
  fallbackMidi: number;
}

/** Chromatic offsets shown either side of the focused note. */
const NEIGHBOURS = [-2, -1, 1, 2] as const;

const VERDICT_TEXT: Record<string, string> = {
  idle: '',
  intune: 'In tune',
  flat: 'Too flat',
  sharp: 'Too sharp',
};

/**
 * The note carousel.
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

  const namingRef = useRef(naming);
  namingRef.current = naming;
  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const fallbackRef = useRef(fallbackMidi);
  fallbackRef.current = fallbackMidi;

  // Last written values — avoids touching the DOM when nothing changed.
  const prev = useRef({ midi: -1, signal: '', intune: '', naming: '' as string });

  useTunerFrame((frame) => {
    const p = prev.current;
    const centre = frame.targetMidi > 0 ? frame.targetMidi : fallbackRef.current;

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
  });

  return (
    <div className="note-block">
      <div
        className="carousel"
        ref={wrapRef}
        data-signal="false"
        data-intune="false"
        data-naming={naming}
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
    </div>
  );
}

/**
 * Direction indicator. Lives immediately above the screen rather than under
 * the carousel, so it reads as a caption on the needle it describes.
 *
 * Words only — the needle and the readout already carry the amount, and a
 * third copy of the number would compete with the note for the first glance.
 */
export function TuningVerdict({ tolerance }: { tolerance: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const prev = useRef('');

  useTunerFrame((frame) => {
    const state = !frame.hasSignal
      ? 'idle'
      : Math.abs(frame.cents) <= toleranceRef.current
        ? 'intune'
        : frame.cents < 0
          ? 'flat'
          : 'sharp';
    if (state === prev.current) return;
    prev.current = state;
    ref.current?.setAttribute('data-state', state);
    if (textRef.current) textRef.current.textContent = VERDICT_TEXT[state];
  });

  return (
    <div className="verdict" ref={ref} data-state="idle" aria-live="polite">
      <span ref={textRef} />
    </div>
  );
}
