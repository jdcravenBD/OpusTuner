/**
 * The tuner screens, and the pager that moves between them.
 *
 * Two readings of the same number, each best at a different distance. The field
 * shows you a semitone either way and the shape of the last few seconds; the
 * strobe throws the number away and leaves you with motion against stillness,
 * which is the finer of the two and the one you finish on.
 */

import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { PitchField } from './PitchField';
import { StrobeDisc } from './StrobeDisc';
import { useSwipe } from '../../hooks/drag';
import { ChevronLeftIcon, ChevronRightIcon } from '../Icons';
import { VISUALS, stepVisual, visualIndex, type VisualId } from './registry';
import type { VisualProps } from './shared';

export { VISUALS, DEFAULT_VISUAL, stepVisual, visualIndex } from './registry';
export type { VisualId } from './registry';

const COMPONENTS: Record<VisualId, ComponentType<VisualProps>> = {
  field: PitchField,
  strobe: StrobeDisc,
};

/** Keep in step with the slide animation in app.css. */
const SLIDE_MS = 300;

interface Props extends VisualProps {
  visual: VisualId;
  onChange: (id: VisualId) => void;
  /** Capture rate, shown as small print in the opposite corner. */
  sampleRateLabel: string;
}

export function TunerVisual({ visual, onChange, sampleRateLabel, ...rest }: Props) {
  const fieldRef = useRef<HTMLDivElement>(null);

  /*
   * The screen being left behind, kept mounted just long enough to slide out.
   *
   * Both canvases are live during the handover — each one subscribes to the
   * frame stream on mount — which is the point: the outgoing screen keeps
   * reading right up until it is off the edge, so the swap looks like moving
   * the instrument rather than like the picture being replaced.
   */
  const [leaving, setLeaving] = useState<{ id: VisualId; dir: 1 | -1 } | null>(null);
  // Direction is recorded when the user acts rather than inferred afterwards:
  // with two screens, "next" and "previous" land on the same one.
  const dirRef = useRef<1 | -1>(1);
  const shown = useRef(visual);

  // Layout effect, not an effect: this has to commit in the same frame the new
  // screen first appears, or the screen pops into place and only then starts
  // sliding.
  useLayoutEffect(() => {
    if (shown.current === visual) return;
    setLeaving({ id: shown.current, dir: dirRef.current });
    shown.current = visual;
    const timer = setTimeout(() => setLeaving(null), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [visual]);

  const go = (by: 1 | -1) => {
    if (leaving) return; // one at a time; a queued swap has nowhere to slide from
    dirRef.current = by;
    onChange(stepVisual(visual, by));
  };

  // Swiping the screen itself is the direct way to do this; the arrows are
  // there so the gesture is discoverable, and so a mouse has something to hit.
  useSwipe(fieldRef, go);

  const prev = VISUALS[visualIndex(stepVisual(visual, -1))];
  const next = VISUALS[visualIndex(stepVisual(visual, 1))];

  return (
    <div className="field-row">
      <button
        className="visual-nav"
        onClick={() => go(-1)}
        aria-label={`Previous display: ${prev.name}`}
        title={prev.name}
      >
        <ChevronLeftIcon />
      </button>

      <div className="field" id="field" ref={fieldRef}>
        {leaving && (
          <Screen
            key={leaving.id}
            id={leaving.id}
            role="out"
            dir={leaving.dir}
            sampleRateLabel={sampleRateLabel}
            {...rest}
          />
        )}
        <Screen
          key={visual}
          id={visual}
          role={leaving ? 'in' : 'still'}
          dir={leaving?.dir ?? 1}
          sampleRateLabel={sampleRateLabel}
          {...rest}
        />
      </div>

      <button
        className="visual-nav"
        onClick={() => go(1)}
        aria-label={`Next display: ${next.name}`}
        title={next.name}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

/**
 * One screen and the small print that belongs to it, as a single sliding layer.
 *
 * The ♭/♯ marks and the corner labels travel with their own screen rather than
 * staying put, because they differ between screens — the strobe wants its
 * accidentals in the corners — and leaving them behind would show the incoming
 * screen's furniture over the outgoing one's face.
 */
function Screen({
  id,
  role,
  dir,
  sampleRateLabel,
  ...rest
}: VisualProps & {
  id: VisualId;
  role: 'in' | 'out' | 'still';
  dir: 1 | -1;
  sampleRateLabel: string;
}) {
  const meta = VISUALS[visualIndex(id)];
  const Component = COMPONENTS[id];
  const edge = dir === 1 ? '100%' : '-100%';

  return (
    <div
      className={`field__screen${role === 'still' ? '' : ` field__screen--${role}`}`}
      data-visual={id}
      style={
        role === 'still'
          ? undefined
          : ({ '--slide-from': edge, '--slide-to': dir === 1 ? '-100%' : '100%' } as React.CSSProperties)
      }
    >
      <Component {...rest} />
      <span className="field__edge field__edge--flat" aria-hidden>
        ♭
      </span>
      <span className="field__edge field__edge--sharp" aria-hidden>
        ♯
      </span>
      {/* Instrument-face small print: which screen, its range, capture rate. */}
      <span className="field__note field__note--bl" aria-hidden>
        {meta.name.toUpperCase()} · {meta.range}
      </span>
      <span className="field__note field__note--br" aria-hidden>
        {sampleRateLabel}
      </span>
    </div>
  );
}
