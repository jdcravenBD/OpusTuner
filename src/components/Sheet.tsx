import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../hooks';
import { useSheetGestures } from '../hooks/drag';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional control in the top-left slot (e.g. a back arrow). */
  left?: ReactNode;
  /** Optional control in the top-right slot, e.g. a Save button. */
  right?: ReactNode;
  /**
   * Hold the sheet at full height regardless of content, so a list that
   * changes length between tabs doesn't resize the panel under the user.
   */
  tall?: boolean;
}

/** How long the panel takes to leave. Matches the sheet-out keyframes. */
export const SHEET_EXIT_MS = 210;

/** Bottom sheet on phones, centred dialog on wide screens. */
export function Sheet({ open, title, onClose, children, left, right, tall }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  /** True once the heading in the list has scrolled up out of sight. */
  const [scrolled, setScrolled] = useState(false);
  /**
   * True while the list has not moved at all.
   *
   * A second signal rather than a reuse of the one above, because the two
   * things they drive start at different moments. The blur at the top has to
   * be there the instant anything is under it, which includes the heading on
   * its way out; the title in the bar must not arrive until that heading has
   * gone, or the panel says its own name twice.
   */
  const [atTop, setAtTop] = useState(true);

  /*
   * Held on past `open` going false so the panel can slide back down rather
   * than blinking out of existence.
   *
   * Deliberately *not* a `visible` flag set from an effect. That renders
   * nothing on the commit where `open` first turns true and only mounts the
   * panel a render later — by which time useSheetGestures below has already
   * run, found a null ref, and given up. Its deps never change again, so it
   * never reattaches, and the sheet silently stops being swipeable. Being
   * derived from `open` means the panel is in the DOM on the same commit.
   */
  const [closing, setClosing] = useState(false);

  /*
   * Set when the panel saw itself out.
   *
   * The drag-to-dismiss gesture animates the panel away with the inline
   * transform it has been driving under the finger, and is already at the
   * bottom by the time it calls onClose; a keyframe animation over the top of
   * that restarts the movement from zero and the sheet jumps back up before
   * leaving. Asked rather than inferred from the DOM, because by the time the
   * effect below runs the panel has already unmounted and the ref is null —
   * which reads as "no transform" and plays the very animation it is there to
   * suppress.
   */
  const sawItselfOut = useRef(false);

  /*
   * Adjusted during render rather than from an effect, which matters at both
   * ends. An effect that mounts the panel runs a render too late, and
   * useSheetGestures below has already looked for it, found nothing and given
   * up — its deps never change again, so the sheet silently stops being
   * swipeable. An effect that starts the exit is a render too late the other
   * way, and the panel blinks out for a frame before reappearing to animate.
   * Setting state while rendering on a changed prop is React's own escape
   * hatch for exactly this: it re-runs before anything is committed.
   */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      sawItselfOut.current = false;
      setClosing(false);
    } else if (sawItselfOut.current) {
      sawItselfOut.current = false;
    } else {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), SHEET_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  // No body scroll lock: nothing behind the sheet scrolls in the first place
  // (the app is a fixed-height, overflow-hidden box), and toggling body
  // overflow on a phone can talk the browser into showing or hiding its URL
  // bar, which changes 100dvh and shifts the whole app under the panel.
  useEscape(open, onClose);
  useSheetGestures(open, panelRef, bodyRef, () => {
    sawItselfOut.current = true;
    onClose();
  });

  // Move focus into the sheet so keyboard and screen-reader users land inside it.
  //
  // preventScroll matters here. The sheet is absolutely positioned against the
  // app's padding box, which extends below its content box by the bottom safe
  // area, so the app counts as having somewhere to scroll to. Focusing without
  // it makes the browser helpfully scroll the sheet into view and shunt the
  // whole tuner up behind the panel.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open]);

  /*
   * Hand the title to the bar when the heading in the list goes under it.
   *
   * Watched rather than measured: a scroll handler would need a pixel to
   * compare against, and that pixel is the height of a heading whose type
   * size, margins and font are all free to change. Asking the heading itself
   * when it has left the scrolling box needs none of that, and it costs
   * nothing per frame — the observer only fires on the crossing.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body) return;
    // Same value, same state: React bails out of the re-render, so this is a
    // comparison per scroll event and a render only on the crossing.
    const onScroll = () => setAtTop(body.scrollTop <= 0);
    onScroll();
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [open]);

  useEffect(() => {
    const heading = titleRef.current;
    const body = bodyRef.current;
    if (!open || !heading || !body) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { root: body, threshold: 0 },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, [open]);

  if (!open && !closing) return null;

  // Rendered into the app element rather than <body>: on a wide window the app
  // is a column narrower than the page, and a sheet mounted on the body would
  // slide up across the whole browser window instead of over the app.
  const host = document.getElementById('app') ?? document.body;

  return createPortal(
    <>
      <div className="scrim" data-closing={closing} onClick={onClose} />
      <div
        className={tall ? 'sheet sheet--tall' : 'sheet'}
        data-closing={closing}
        data-scrolled={scrolled}
        data-at-top={atTop}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        {/* Grip and header double as the sheet's grab handle — see useSheetGestures. */}
        <div className="sheet__grip sheet__handle" />
        {/*
          * The bar carries the title only once the big one has gone.
          *
          * There is no close button any more: a sheet is dismissed by pulling
          * it down, by pressing the page behind it, or by Escape, and all
          * three were already here — the cross was a fourth way to do what the
          * grip above it is already advertising.
          */}
        <div className="sheet__head sheet__handle">
          <div>{left}</div>
          <div className="sheet__title" aria-hidden>
            {title}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
        </div>
        <div className="sheet__scroll">
          <div className="sheet__body" ref={bodyRef}>
            {/*
              * The title as a heading in the list, which is where it starts.
              * The bar's copy fades in as this one leaves, and the swap is
              * driven by this element rather than by a scroll distance, so
              * there is no number to keep in step with the type size.
              */}
            <h2 className="sheet__bigtitle" ref={titleRef}>
              {title}
            </h2>
            {children}
          </div>
          {/*
            * The two edges of a scrolling list, and they are not the same
            * shape. Content passing under the bar is blurred as well as
            * faded, which is what stops a line of text reading through the
            * title sitting over it; at the bottom there is nothing over the
            * content, so a fade is the whole of it.
            */}
          <div className="sheet__fade sheet__fade--top" aria-hidden />
          <div className="sheet__fade sheet__fade--bottom" aria-hidden />
        </div>
      </div>
    </>,
    host,
  );
}
