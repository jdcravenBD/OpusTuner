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
}

/** Bottom sheet on phones, centred dialog on wide screens. */
export function Sheet({ open, title, onClose, children, left, right }: Props) {
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

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="sheet"
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
    document.body,
  );
}
