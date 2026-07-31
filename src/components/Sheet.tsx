import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape, useScrollLock } from '../hooks';
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

  useScrollLock(open);
  useEscape(open, onClose);

  // Move focus into the sheet so keyboard and screen-reader users land inside it.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => panelRef.current?.focus());
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
        <div className="sheet__grip" />
        <div className="sheet__head">
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
        <div className="sheet__body">{children}</div>
      </div>
    </>,
    host,
  );
}
