/**
 * The tuner screens, and the pager that moves between them.
 *
 * Two readings of the same number, each best at a different distance. The field
 * shows you a semitone either way and the shape of the last few seconds; the
 * strobe throws the number away and leaves you with motion against stillness,
 * which is the finer of the two and the one you finish on.
 *
 * The whole screen — its frame, its recess, its small print — is what moves
 * when you change between them. Dragging carries it under the finger rather
 * than playing an animation at you, so a half-swipe shows you half of each and
 * lets you change your mind.
 */

import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { PitchField } from './PitchField';
import { StrobeDisc } from './StrobeDisc';
import { ChevronLeftIcon, ChevronRightIcon } from '../Icons';
import { VISUALS, stepVisual, visualIndex, type VisualId } from './registry';
import type { VisualProps } from './shared';

export { VISUALS, DEFAULT_VISUAL, stepVisual, visualIndex } from './registry';
export type { VisualId } from './registry';

const COMPONENTS: Record<VisualId, ComponentType<VisualProps>> = {
  field: PitchField,
  strobe: StrobeDisc,
};

/** Space between one screen and the next while they are both on the move. */
const DECK_GAP = 18;
/** Travel before a press is treated as a drag rather than a tap. */
const SLOP = 6;
/** Fraction of a screen's width that commits the change on release. */
const COMMIT_FRACTION = 0.32;
/** ...or this much speed, in px/ms, having moved at least a tenth of the way. */
const COMMIT_VELOCITY = 0.45;
const FLICK_MIN_FRACTION = 0.1;
/** How long the release takes to settle. */
const SETTLE_MS = 260;
const SETTLE_EASE = 'cubic-bezier(.22, .61, .36, 1)';

interface Props extends VisualProps {
  visual: VisualId;
  onChange: (id: VisualId) => void;
  /** Capture rate, shown as small print in the opposite corner. */
  sampleRateLabel: string;
}

export function TunerVisual({ visual, onChange, sampleRateLabel, ...rest }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);

  /*
   * Whether the neighbouring screen is mounted.
   *
   * Only while a gesture is in flight: at rest a second screen would sit just
   * off the edge, running a canvas nobody is looking at, and peeking past the
   * crop on narrow screens.
   */
  const [active, setActive] = useState(false);
  /** Set on release so the layout effect can run the settle animation. */
  const [settleTo, setSettleTo] = useState<1 | -1 | 0 | null>(null);

  const drag = useRef({ id: -1, startX: 0, lastX: 0, lastT: 0, velocity: 0, dx: 0, live: false });
  const busy = useRef(false);
  const otherId = stepVisual(visual, 1);

  /** Distance from one screen's centre to the next. */
  const step = () => (deckRef.current?.offsetWidth ?? 0) + DECK_GAP;

  /**
   * Writes the deck's position straight to the DOM.
   *
   * The neighbour's side is taken from the sign of the drag rather than fixed
   * at mount, because with two screens "previous" and "next" are the same one —
   * it belongs on whichever side you are pulling from.
   */
  const place = (dx: number, animate: boolean) => {
    const deck = deckRef.current;
    if (!deck) return;
    const w = step();
    const side = dx > 0 ? -1 : 1;
    for (const el of Array.from(deck.children) as HTMLElement[]) {
      const slot = el.dataset.screen === visual ? 0 : side;
      el.style.transition = animate ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}` : 'none';
      el.style.transform = `translateX(${dx + slot * w}px)`;
    }
  };

  /* --- release, and the arrow presses that borrow the same path ---------- */

  useLayoutEffect(() => {
    if (settleTo === null) return;
    place(settleTo * step(), true);
    const timer = setTimeout(() => {
      busy.current = false;
      if (settleTo !== 0) onChange(stepVisual(visual, settleTo === -1 ? 1 : -1));
      setSettleTo(null);
      setActive(false);
      rowRef.current?.removeAttribute('data-sliding');
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleTo]);

  // After a change lands, the incoming screen is already centred — it is the
  // same element, kept mounted through the swap — so this only clears the
  // inline transforms without moving anything.
  useLayoutEffect(() => {
    if (settleTo === null && !active) place(0, false);
  });

  const begin = (dir: 1 | -1) => {
    if (busy.current) return;
    busy.current = true;
    setActive(true);
    rowRef.current?.setAttribute('data-sliding', 'true');
    // -1 sends the deck left, which brings the next screen in from the right.
    setSettleTo(dir === 1 ? -1 : 1);
  };

  /* --- dragging ---------------------------------------------------------- */

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const d = drag.current;
    d.id = e.pointerId;
    d.startX = d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    d.velocity = 0;
    d.dx = 0;
    d.live = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.id !== e.pointerId || busy.current) return;
    const dx = e.clientX - d.startX;

    if (!d.live) {
      if (Math.abs(dx) < SLOP) return;
      d.live = true;
      setActive(true);
      rowRef.current?.setAttribute('data-sliding', 'true');
      deckRef.current?.setPointerCapture?.(e.pointerId);
    }

    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity += ((e.clientX - d.lastX) / dt - d.velocity) * 0.4;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;

    // Resistance at the ends is deliberately absent: the list wraps, so there
    // is always something real on both sides.
    d.dx = dx;
    place(dx, false);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    d.id = -1;
    if (!d.live) return;
    d.live = false;

    const w = step();
    const moved = Math.abs(d.dx);
    const flicked =
      Math.abs(d.velocity) >= COMMIT_VELOCITY && moved >= w * FLICK_MIN_FRACTION;
    const commit = moved >= w * COMMIT_FRACTION || flicked;

    busy.current = true;
    setSettleTo(commit ? (d.dx < 0 ? -1 : 1) : 0);
  };

  const prev = VISUALS[visualIndex(stepVisual(visual, -1))];
  const next = VISUALS[visualIndex(stepVisual(visual, 1))];

  return (
    <div className="field-row" ref={rowRef}>
      <button
        className="visual-nav"
        onClick={() => begin(-1)}
        aria-label={`Previous display: ${prev.name}`}
        title={prev.name}
      >
        <ChevronLeftIcon />
      </button>

      <div
        className="field-deck"
        id="field"
        ref={deckRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Keyed by screen, so the one you drag in keeps its canvas when it
            becomes the current one — a remount here would blank it. */}
        <Screen key={visual} id={visual} sampleRateLabel={sampleRateLabel} {...rest} />
        {active && otherId !== visual && (
          <Screen key={otherId} id={otherId} sampleRateLabel={sampleRateLabel} {...rest} />
        )}
      </div>

      <button
        className="visual-nav"
        onClick={() => begin(1)}
        aria-label={`Next display: ${next.name}`}
        title={next.name}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

/**
 * One screen: the recessed square, its canvas, and the small print that belongs
 * to it. The ♭/♯ marks travel with their own screen — the strobe wants its
 * accidentals in the corners, and leaving them behind would show the incoming
 * screen's furniture over the outgoing one's face.
 */
function Screen({
  id,
  sampleRateLabel,
  ...rest
}: VisualProps & { id: VisualId; sampleRateLabel: string }) {
  const meta = VISUALS[visualIndex(id)];
  const Component = COMPONENTS[id];

  return (
    <div className="field" data-screen={id} data-visual={id}>
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
