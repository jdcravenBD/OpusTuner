import { useEffect, useRef, type ReactNode } from 'react';
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
}

/** Bottom sheet on phones, centred dialog on wide screens. */
export function Sheet({ open, title, onClose, children, left, right, tall }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // No body scroll lock: nothing behind the sheet scrolls in the first place
  // (the app is a fixed-height, overflow-hidden box), and toggling body
  // overflow on a phone can talk the browser into showing or hiding its URL
  // bar, which changes 100dvh and shifts the whole app under the panel.
  useEscape(open, onClose);
  useSheetGestures(open, panelRef, bodyRef, onClose);

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

  if (!open) return null;

  // Rendered into the app element rather than <body>: on desktop the app is
  // drawn in a phone-shaped frame, and a sheet mounted on the body would slide
  // up over the whole browser window instead of over the app.
  const host = document.getElementById('app') ?? document.body;

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className={tall ? 'sheet sheet--tall' : 'sheet'}
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
