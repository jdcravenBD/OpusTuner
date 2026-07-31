/**
 * The tuner screens, and the pager that moves between them.
 *
 * Three readings of the same number, each best at a different distance. The
 * field shows you a semitone either way and the shape of the last few seconds;
 * the needle trades that range for resolution; the strobe throws away the
 * number entirely and leaves you with motion against stillness, which is the
 * finest of the three and the one you finish on.
 */

import { useRef, type ComponentType } from 'react';
import { PitchField } from './PitchField';
import { ArcMeter } from './ArcMeter';
import { StrobeDisc } from './StrobeDisc';
import { useSwipe } from '../../hooks/drag';
import { ChevronLeftIcon, ChevronRightIcon } from '../Icons';
import { VISUALS, stepVisual, visualIndex, type VisualId } from './registry';
import type { VisualProps } from './shared';

export { VISUALS, DEFAULT_VISUAL, stepVisual, visualIndex } from './registry';
export type { VisualId } from './registry';

const COMPONENTS: Record<VisualId, ComponentType<VisualProps>> = {
  field: PitchField,
  needle: ArcMeter,
  strobe: StrobeDisc,
};

interface Props extends VisualProps {
  visual: VisualId;
  onChange: (id: VisualId) => void;
  /** Capture rate, shown as small print in the opposite corner. */
  sampleRateLabel: string;
}

export function TunerVisual({ visual, onChange, sampleRateLabel, ...rest }: Props) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const meta = VISUALS[visualIndex(visual)];
  const Component = COMPONENTS[meta.id];

  // Swiping the screen itself is the direct way to do this; the arrows are
  // there so the gesture is discoverable, and so a mouse has something to hit.
  useSwipe(fieldRef, (direction) => onChange(stepVisual(visual, direction)));

  const prev = VISUALS[visualIndex(stepVisual(visual, -1))];
  const next = VISUALS[visualIndex(stepVisual(visual, 1))];

  return (
    <div className="field-row">
      <button
        className="visual-nav"
        onClick={() => onChange(prev.id)}
        aria-label={`Previous display: ${prev.name}`}
        title={prev.name}
      >
        <ChevronLeftIcon />
      </button>

      <div className="field" ref={fieldRef}>
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

      <button
        className="visual-nav"
        onClick={() => onChange(next.id)}
        aria-label={`Next display: ${next.name}`}
        title={next.name}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
