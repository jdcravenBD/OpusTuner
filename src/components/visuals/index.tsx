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
/** The screen being left behind is gone well before it stops moving. */
const FADE_MS = 170;

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

  /*
   * Which side the neighbouring screen sits on, as a slot index.
   *
   * With two screens, "previous" and "next" are the same one, so this belongs
   * to the gesture rather than to the screen: dragging right pulls in the one
   * on the left, and the arrows say outright which side they mean. It is held
   * rather than recomputed from the drag offset, because at the moment of
   * release that offset is on its way back to zero — reading the side from it
   * there sent the neighbour across the deck in the middle of the animation.
   */
  const side = useRef<1 | -1>(1);

  /** Distance from one screen's centre to the next. */
  const step = () => (deckRef.current?.offsetWidth ?? 0) + DECK_GAP;

  /** Writes the deck's position straight to the DOM. */
  const place = (dx: number, animate: boolean) => {
    const deck = deckRef.current;
    if (!deck) return;
    const w = step();
    for (const el of Array.from(deck.children) as HTMLElement[]) {
      const slot = el.dataset.screen === visual ? 0 : side.current;
      const at = dx + slot * w;
      // Only the screen that lands centred survives the settle. Fading the
      // other one as it goes means it is already invisible by the time the
      // movement ends, whenever the gesture actually gets torn down.
      const leaving = animate && Math.abs(at) > 0.5;
      el.style.transition = animate
        ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}, opacity ${FADE_MS}ms linear`
        : 'none';
      el.style.transform = `translateX(${at}px)`;
      el.style.opacity = leaving ? '0' : '1';
    }
  };

  /* --- release, and the arrow presses that borrow the same path ---------- */

  useLayoutEffect(() => {
    if (settleTo === null) return;
    const deck = deckRef.current;
    if (!deck) return;

    /*
     * A screen mounted by the same render that started this has no transform
     * of its own yet, so there is nothing for the browser to move it away
     * from and it simply appears at the centre — which is what pressing an
     * arrow used to look like: the new screen materialised on top and the old
     * one slid out from under it. Park it at its edge and flush the style
     * before starting, so it has somewhere to come from.
     */
    let parked = false;
    for (const el of Array.from(deck.children) as HTMLElement[]) {
      if (el.style.transform) continue;
      const slot = el.dataset.screen === visual ? 0 : side.current;
      el.style.transition = 'none';
      el.style.transform = `translateX(${slot * step()}px)`;
      el.style.opacity = '1';
      parked = true;
    }
    if (parked) void deck.offsetHeight;

    place(settleTo * step(), true);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      busy.current = false;
      if (settleTo !== 0) onChange(stepVisual(visual, settleTo === -1 ? 1 : -1));
      setSettleTo(null);
      setActive(false);
      rowRef.current?.removeAttribute('data-sliding');
    };

    /*
     * The movement itself runs on the compositor and lands on time. The timer
     * that used to end the gesture runs on a main thread busy with an FFT and
     * a canvas for each of the two screens, and can be a long way late — which
     * is the outgoing screen still sitting there after the new one has
     * settled. Take the end of the transition as the signal, and keep a timer
     * only as a backstop for the case where none is ever reported.
     */
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== 'transform') return;
      if (!(e.target as HTMLElement).dataset?.screen) return;
      finish();
    };
    deck.addEventListener('transitionend', onEnd);
    const timer = setTimeout(finish, SETTLE_MS + 120);

    return () => {
      deck.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleTo]);

  /*
   * After a change lands, the incoming screen is already centred — it is the
   * same element, kept mounted through the swap — so this only clears the
   * inline transforms without moving anything.
   *
   * It also catches the frame the neighbour mounts on. That screen arrives
   * with no transform of its own, which is the centre, so for one frame it sat
   * squarely on top of the screen being dragged until the next pointermove
   * moved it out to the edge.
   */
  useLayoutEffect(() => {
    if (settleTo !== null) return;
    place(drag.current.live ? drag.current.dx : 0, false);
  });

  const begin = (dir: 1 | -1) => {
    if (busy.current) return;
    busy.current = true;
    // Next arrives from the right, previous from the left.
    side.current = dir === 1 ? 1 : -1;
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
      side.current = dx > 0 ? -1 : 1;
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
    side.current = dx > 0 ? -1 : 1;
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
