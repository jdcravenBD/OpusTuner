/**
 * Pointer-drag gestures, so a mouse gets the same reach a finger has.
 *
 * On a phone the sheets are already direct-manipulation surfaces: you flick the
 * list, you drag the panel away. With a mouse those same surfaces only respond
 * to a wheel and a close button. These handlers close that gap — grab anywhere
 * and pull.
 *
 * Touch is left almost entirely alone on purpose. Native touch scrolling has
 * momentum, rubber-banding and hand-off to the compositor that no script can
 * match, and taking it over would be a downgrade. The single exception is the
 * sheet's grab handle, which is a drag target for every kind of pointer.
 */

import { useEffect, useRef, type RefObject } from 'react';

/** Movement before a press stops being a click and becomes a drag. */
const DRAG_SLOP = 6;
/** Pull the sheet down further than this and it dismisses. */
const CLOSE_DISTANCE = 96;
/**
 * ...or flick it faster than this, in px/ms, having got at least
 * CLOSE_FLICK_FRACTION of the way.
 *
 * The distance floor is not optional. Velocity here is measured between two
 * consecutive move events, which on a 120 Hz screen are 8 ms apart, so an
 * unremarkable drag of five pixels already reads as 0.6 px/ms. Without a
 * minimum travel, half the times you touched the sheet it would fly away.
 */
const CLOSE_VELOCITY = 0.55;
const CLOSE_FLICK_FRACTION = 0.35;
/**
 * Weight of the newest sample in the velocity average. A single sample taken a
 * few milliseconds apart is nearly noise; averaging means only *sustained*
 * speed reads as a flick, which is what a flick is.
 */
const VELOCITY_SMOOTHING = 0.4;
/** Resistance applied when dragging a sheet *up*, which has nowhere to go. */
const RUBBER_BAND = 0.22;
/** Per-frame velocity decay for the glide after a drag-scroll is released. */
const GLIDE_DECAY = 0.94;
/** Velocity below which the glide has effectively stopped, in px/frame. */
const GLIDE_MIN = 0.35;

/** Sideways travel that counts as a swipe rather than a stray press. */
const SWIPE_DISTANCE = 44;
/** ...or this much speed, in px/ms, however far it got. */
const SWIPE_VELOCITY = 0.4;

type Mode = 'idle' | 'undecided' | 'scroll-x' | 'scroll-y' | 'close';

/** Controls that own their own pointer behaviour and must not be dragged over. */
const INTERACTIVE = 'input, textarea, select, [contenteditable]';

/**
 * Nearest ancestor between `from` and `root` that actually scrolls sideways.
 * Used to route a horizontal drag to the filter chips rather than the list.
 */
function horizontalScroller(from: EventTarget | null, root: Element): HTMLElement | null {
  let el = from instanceof Element ? from : null;
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.scrollWidth - el.clientWidth > 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Swallows the click that a browser fires at the end of a drag, so releasing
 * over a list row doesn't also pick it.
 */
function swallowNextClick(): void {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
}

/**
 * Horizontal swipe on an element, for paging between panels.
 *
 * Every pointer type, because a swipe is the natural gesture on a phone and a
 * perfectly good one with a mouse held down. The element needs
 * `touch-action: none` (or at least `pan-y`) or the browser will claim the
 * gesture before the first pointermove arrives.
 *
 * @param onSwipe called with -1 for a rightward swipe (go back) and +1 for a
 *   leftward one (go forward), matching the direction the content moves.
 */
export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  onSwipe: (direction: -1 | 1) => void,
): void {
  const handler = useRef(onSwipe);
  handler.current = onSwipe;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let last = 0;
    let lastTime = 0;
    let velocity = 0;
    let live = false;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      pointerId = e.pointerId;
      live = true;
      startX = last = e.clientX;
      startY = e.clientY;
      lastTime = e.timeStamp;
      velocity = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (!live || e.pointerId !== pointerId) return;
      const dt = e.timeStamp - lastTime;
      if (dt > 0) {
        velocity += ((e.clientX - last) / dt - velocity) * VELOCITY_SMOOTHING;
      }
      last = e.clientX;
      lastTime = e.timeStamp;
      // A mostly-vertical drag isn't ours; let go of it rather than firing on
      // the small sideways component every such gesture carries.
      if (Math.abs(e.clientY - startY) > Math.abs(e.clientX - startX) + SWIPE_DISTANCE) {
        live = false;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!live || e.pointerId !== pointerId) return;
      live = false;
      pointerId = -1;
      const dx = Math.abs(e.clientX - startX);
      // A flick counts for less travel than a drag, but never for none: a fast
      // twitch of a few pixels is a tap with an unsteady hand, and paging on it
      // makes the screen feel like it changes at random.
      const dragged = dx >= SWIPE_DISTANCE;
      const flicked = Math.abs(velocity) >= SWIPE_VELOCITY && dx >= SWIPE_DISTANCE * 0.4;
      if (!dragged && !flicked) return;
      handler.current(e.clientX < startX ? 1 : -1);
    };

    const cancel = () => {
      live = false;
      pointerId = -1;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('pointerleave', cancel);
    };
  }, [ref]);
}

/**
 * Wires drag-to-scroll and drag-to-dismiss onto a bottom sheet.
 *
 * @param open      whether the sheet is on screen. Load-bearing: the sheet
 *   renders nothing while closed, so the refs below are null until this flips
 *   and the effect has to re-run to find them.
 * @param panelRef  the sheet itself — the thing that moves when dismissed
 * @param bodyRef   its scrolling content area
 * @param onClose   called once the sheet has been pulled far or fast enough
 */
export function useSheetGestures(
  open: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  bodyRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const body = bodyRef.current;
    if (!panel || !body) return;

    let pointerId = -1;
    let mode: Mode = 'idle';
    let fromHandle = false;
    let startX = 0;
    let startY = 0;
    let startScroll = 0;
    let track: HTMLElement | null = null;
    let last = 0;
    let lastTime = 0;
    let velocity = 0;
    let glideId = 0;
    let closing = false;

    const stopGlide = () => {
      if (glideId) cancelAnimationFrame(glideId);
      glideId = 0;
    };

    const onDown = (e: PointerEvent) => {
      if (closing || mode !== 'idle') return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;

      stopGlide();
      fromHandle = e.target instanceof Element && !!e.target.closest('.sheet__handle');
      // A finger keeps its native scrolling; only the grab handle is ours.
      if (e.pointerType === 'touch' && !fromHandle) return;

      pointerId = e.pointerId;
      mode = 'undecided';
      startX = e.clientX;
      startY = e.clientY;
      track = horizontalScroller(e.target, panel);
      last = e.clientY;
      lastTime = e.timeStamp;
      velocity = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || mode === 'idle') return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (mode === 'undecided') {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        if (track && Math.abs(dx) > Math.abs(dy)) {
          mode = 'scroll-x';
          startScroll = track.scrollLeft;
        } else if (fromHandle || (dy > 0 && body.scrollTop <= 0)) {
          // Pulling down with nothing left to scroll means "put this away".
          mode = 'close';
          panel.style.animation = 'none';
          panel.style.transition = 'none';
        } else {
          mode = 'scroll-y';
          startScroll = body.scrollTop;
        }
        // Throws if the pointer has already been released out from under us.
        try {
          panel.setPointerCapture(pointerId);
        } catch {
          /* keep dragging without capture */
        }
        last = mode === 'scroll-x' ? e.clientX : e.clientY;
        lastTime = e.timeStamp;
      }

      // Velocity over the last move only: a running average lags a flick badly,
      // and a flick is exactly what needs to be caught here.
      const pos = mode === 'scroll-x' ? e.clientX : e.clientY;
      const dt = e.timeStamp - lastTime;
      if (dt > 0) velocity += ((pos - last) / dt - velocity) * VELOCITY_SMOOTHING;
      last = pos;
      lastTime = e.timeStamp;

      if (mode === 'scroll-x' && track) {
        track.scrollLeft = startScroll - dx;
      } else if (mode === 'scroll-y') {
        body.scrollTop = startScroll - dy;
      } else if (mode === 'close') {
        panel.style.transform = `translateY(${dy > 0 ? dy : dy * RUBBER_BAND}px)`;
      }
      e.preventDefault();
    };

    /** Inertial coast, so a flick keeps going the way a finger's would. */
    const startGlide = (target: HTMLElement, axis: 'x' | 'y') => {
      let v = velocity * 16; // px per frame at 60 Hz
      if (Math.abs(v) < GLIDE_MIN) return;
      const step = () => {
        if (axis === 'x') target.scrollLeft -= v;
        else target.scrollTop -= v;
        v *= GLIDE_DECAY;
        glideId = Math.abs(v) > GLIDE_MIN ? requestAnimationFrame(step) : 0;
      };
      glideId = requestAnimationFrame(step);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const finished = mode;
      const dy = e.clientY - startY;
      mode = 'idle';
      pointerId = -1;
      try {
        if (panel.hasPointerCapture(e.pointerId)) panel.releasePointerCapture(e.pointerId);
      } catch {
        /* already gone */
      }

      if (finished === 'undecided' || finished === 'idle') return;
      swallowNextClick();

      if (finished === 'scroll-x' && track) startGlide(track, 'x');
      else if (finished === 'scroll-y') startGlide(body, 'y');
      else if (finished === 'close') {
        const flickedDown =
          velocity > CLOSE_VELOCITY && dy > CLOSE_DISTANCE * CLOSE_FLICK_FRACTION;
        if (dy > CLOSE_DISTANCE || flickedDown) {
          closing = true;
          panel.style.transition = 'transform 180ms cubic-bezier(.4, 0, 1, 1)';
          panel.style.transform = 'translateY(110%)';
          setTimeout(() => closeRef.current(), 170);
        } else {
          panel.style.transition = 'transform 260ms cubic-bezier(.22, .61, .36, 1)';
          panel.style.transform = '';
        }
      }
    };

    /**
     * A wheel over a sideways scroller moves it sideways.
     *
     * Mice mostly have one wheel and it points the wrong way for a row of
     * filter chips, so a scroll there would otherwise skate straight past them
     * and move the list underneath instead. Trackpads that do send a horizontal
     * delta are used as-is.
     */
    const onWheel = (e: WheelEvent) => {
      const track = horizontalScroller(e.target, panel);
      if (!track) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      const before = track.scrollLeft;
      track.scrollLeft = before + delta;
      // Only claim the gesture if the row actually had somewhere to go, so a
      // wheel at either end still falls through to the list.
      if (track.scrollLeft !== before) e.preventDefault();
    };

    /*
     * Pull-to-dismiss with a finger, from anywhere in the list rather than only
     * from the grab handle.
     *
     * This has to be touch events rather than the pointer path above, because
     * the body scrolls natively: by the time a pointermove arrives the browser
     * has already decided the gesture is a scroll, and nothing script does will
     * take it back. Watching touchmove non-passively lets us claim it — but
     * only when the list is against its top stop and the finger is heading
     * down, so ordinary scrolling is never touched.
     */
    let touchStartY = 0;
    let touchLastY = 0;
    let touchTime = 0;
    let touchVelocity = 0;
    let pulling = false;

    const onTouchStart = (e: TouchEvent) => {
      if (closing || e.touches.length !== 1) return;
      // The handle already has the pointer path, and touch-action: none on it.
      if (e.target instanceof Element && e.target.closest('.sheet__handle')) return;
      touchStartY = touchLastY = e.touches[0].clientY;
      touchTime = e.timeStamp;
      touchVelocity = 0;
      pulling = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (closing || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = y - touchStartY;

      if (!pulling) {
        if (dy < DRAG_SLOP || body.scrollTop > 0) return;
        // Anything under the finger that scrolls sideways is not ours.
        if (horizontalScroller(e.target, panel)) return;
        pulling = true;
        panel.style.animation = 'none';
        panel.style.transition = 'none';
      }

      const dt = e.timeStamp - touchTime;
      if (dt > 0) touchVelocity += ((y - touchLastY) / dt - touchVelocity) * VELOCITY_SMOOTHING;
      touchLastY = y;
      touchTime = e.timeStamp;

      if (e.cancelable) e.preventDefault();
      panel.style.transform = `translateY(${Math.max(0, dy - DRAG_SLOP)}px)`;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!pulling) return;
      pulling = false;
      const travelled = (e.changedTouches[0]?.clientY ?? touchLastY) - touchStartY - DRAG_SLOP;
      const flickedDown =
        touchVelocity > CLOSE_VELOCITY && travelled > CLOSE_DISTANCE * CLOSE_FLICK_FRACTION;
      if (travelled > CLOSE_DISTANCE || flickedDown) {
        closing = true;
        panel.style.transition = 'transform 180ms cubic-bezier(.4, 0, 1, 1)';
        panel.style.transform = 'translateY(110%)';
        setTimeout(() => closeRef.current(), 170);
      } else {
        panel.style.transition = 'transform 260ms cubic-bezier(.22, .61, .36, 1)';
        panel.style.transform = '';
      }
    };

    panel.addEventListener('pointerdown', onDown);
    panel.addEventListener('pointermove', onMove);
    panel.addEventListener('pointerup', onUp);
    panel.addEventListener('pointercancel', onUp);
    panel.addEventListener('wheel', onWheel, { passive: false });
    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd);
    panel.addEventListener('touchcancel', onTouchEnd);

    return () => {
      stopGlide();
      panel.removeEventListener('pointerdown', onDown);
      panel.removeEventListener('pointermove', onMove);
      panel.removeEventListener('pointerup', onUp);
      panel.removeEventListener('pointercancel', onUp);
      panel.removeEventListener('wheel', onWheel);
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('touchend', onTouchEnd);
      panel.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [open, panelRef, bodyRef]);
}
