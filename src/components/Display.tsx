import { useRef } from 'react';
import { useTunerFrame } from '../hooks';
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
 * Precision readout beneath the field: measured pitch, target pitch, and the
 * deviation between them to a tenth of a cent.
 *
 * The needle already carries the deviation, rounded — this is the fine version,
 * deliberately parked at the bottom of the field where it stays available
 * without competing with the note itself.
 */
export function Readout({ show }: { show: boolean }) {
  const detectedRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const deltaRef = useRef<HTMLSpanElement>(null);
  const deltaCellRef = useRef<HTMLSpanElement>(null);
  const prev = useRef({ detected: '', target: '', delta: '', intune: '' });

  useTunerFrame((frame) => {
    const p = prev.current;

    const detected = frame.hasSignal && frame.frequency > 0 ? formatHz(frame.frequency) : '—';
    if (detected !== p.detected) {
      p.detected = detected;
      if (detectedRef.current) detectedRef.current.textContent = detected;
    }

    const target = frame.targetFreq > 0 ? formatHz(frame.targetFreq) : '—';
    if (target !== p.target) {
      p.target = target;
      if (targetRef.current) targetRef.current.textContent = target;
    }

    // ASCII sign rather than a typographic minus: this sits in a monospaced
    // face, and a glyph the face lacks would fall back and break the column.
    const delta = frame.hasSignal
      ? `${frame.cents >= 0 ? '+' : '-'}${Math.abs(frame.cents).toFixed(1)}`
      : '—';
    if (delta !== p.delta) {
      p.delta = delta;
      if (deltaRef.current) deltaRef.current.textContent = delta;
    }

    const intune = String(frame.hasSignal && frame.inTune);
    if (intune !== p.intune) {
      p.intune = intune;
      deltaCellRef.current?.setAttribute('data-intune', intune);
    }
  });

  if (!show) return null;

  return (
    <div className="readout">
      <div className="readout__strip">
        <span className="readout__cell">
          <span className="readout__key">IN</span>
          <span className="readout__val" ref={detectedRef}>
            —
          </span>
          <span className="readout__unit">Hz</span>
        </span>
        <span className="readout__cell">
          <span className="readout__key">TGT</span>
          <span className="readout__val" ref={targetRef}>
            —
          </span>
          <span className="readout__unit">Hz</span>
        </span>
        <span
          className="readout__cell readout__cell--delta"
          ref={deltaCellRef}
          data-intune="false"
        >
          <span className="readout__key">Δ</span>
          <span className="readout__val" ref={deltaRef}>
            —
          </span>
          <span className="readout__unit">¢</span>
        </span>
      </div>
    </div>
  );
}

