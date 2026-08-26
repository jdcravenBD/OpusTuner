import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../hooks';
import { useSheetGestures } from '../hooks/drag';
import { CloseIcon } from './Icons';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional control in the top-left slot (e.g. a back arrow). */
  left?: ReactNode;
  /** Optional control in the top-right slot, replacing the close button. */
  right?: ReactNode;
  /**
   * Hold the sheet at full height regardless of content, so a list that
   * changes length between tabs doesn't resize the panel under the user.
   */
  tall?: boolean;
  /**
   * Shown over another sheet rather than over the app.
   *
   * Without this its scrim sits *below* the panel it was opened from, which
   * stays at full brightness behind it — the new sheet reads as pasted on top
   * rather than as the thing being looked at.
   */
  stacked?: boolean;
}

/** How long the panel takes to leave. Matches the sheet-out keyframes. */
export const SHEET_EXIT_MS = 210;

/** Bottom sheet on phones, centred dialog on wide screens. */
export function Sheet({ open, title, onClose, children, left, right, tall, stacked }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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

  if (!open && !closing) return null;

  // Rendered into the app element rather than <body>: on a wide window the app
  // is a column narrower than the page, and a sheet mounted on the body would
  // slide up across the whole browser window instead of over the app.
  const host = document.getElementById('app') ?? document.body;

  return createPortal(
    <>
      <div
        className={stacked ? 'scrim scrim--stacked' : 'scrim'}
        data-closing={closing}
        onClick={onClose}
      />
      <div
        className={[ 'sheet', tall && 'sheet--tall', stacked && 'sheet--stacked' ]
          .filter(Boolean)
          .join(' ')}
        data-closing={closing}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        {/* Grip and header double as the sheet's grab handle — see useSheetGestures. */}
        <div className="sheet__grip sheet__handle" />
        <div className="sheet__head sheet__handle">
          <div>{left}</div>
          <div className="sheet__title">{title}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {right ?? (
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <CloseIcon />
              </button>
            )}
          </div>
        </div>
        <div className="sheet__body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </>,
    host,
  );
}
