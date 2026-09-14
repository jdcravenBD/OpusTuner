/**
 * The "what does this look like" button, and the little app it draws.
 *
 * Two of the appearance settings pick something you cannot see until you have
 * already picked it, which is a poor bargain for a paid control -- especially
 * Modern, which nobody without the tier can turn on to find out. So each of
 * those rows carries an info button, and the button opens a row of miniature
 * apps, one per option.
 *
 * **They are live, not screenshots.** Every tile is half a dozen divs reading
 * the same custom properties the real chassis reads, so it follows the hue,
 * the colour strength and the light/dark choice already in force, and it
 * cannot go stale the way a picture would the next time a radius changes.
 * Nothing in them animates and nothing runs a canvas -- the whole row is
 * static paint, mounted only while the popup is open -- so there is no frame
 * budget to spend and none is spent.
 *
 * The one thing a tile does *not* inherit is the setting it is illustrating:
 * it would be no use if the Modern tile drew itself in whatever style the app
 * is in at the time. Each tile names its own, and the palette blocks in
 * app.css list `.pv__app` alongside `:root` for exactly that -- the same trick
 * the purchase screen already uses to stay Modern inside a Default app.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../hooks';
import { InfoIcon } from './Icons';
import type { ThemeMode, ThemeStyle, TunerStyle } from '../state/store';

/** Clearance from the button, and from the edges of the window. */
const GAP = 8;
const MARGIN = 10;

interface TileProps {
  /** Which visual language the tile draws itself in. */
  style: ThemeStyle;
  /** How the tuner screen is sized inside it. */
  tuner: TunerStyle;
  /** Light or dark, taken from the app rather than chosen here. */
  mode: ThemeMode;
  label: string;
}

/**
 * One miniature.
 *
 * The title is deliberately absent. It is a paid toggle like the rest, it is
 * the one piece of furniture that says nothing about either setting, and at
 * this size a row of small caps across the top is a grey smear.
 */
function Tile({ style, tuner, mode, label }: TileProps) {
  return (
    <figure className="pv">
      <div className="pv__app" data-pv-style={style} data-pv-tuner={tuner} data-mode={mode}>
        <div className="pv__bar">
          <i />
          <i />
          <i />
        </div>
        <div className="pv__note" />
        <div className="pv__screen">
          <i className="pv__line" />
          <i className="pv__nib" />
        </div>
        <div className="pv__keys">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="pv__foot">
          <i />
          <i />
        </div>
      </div>
      <figcaption className="pv__label">{label}</figcaption>
    </figure>
  );
}

interface Props {
  /** Which row this belongs to, and therefore what the tiles vary. */
  kind: 'app' | 'tuner';
  mode: ThemeMode;
}

export function StyleInfo({ kind, mode }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEscape(open, () => setOpen(false));

  /*
   * Placed by hand, in a portal, because there is nowhere in the settings list
   * it could live and still be seen: Modern draws a section as one card with
   * `overflow: hidden` for its corners, and the sheet's own body scrolls. A
   * panel opening upward out of a row is clipped twice over.
   *
   * Fixed to the window and measured from the button, which is also what makes
   * the flip below possible. Centred on the button, held inside the window at
   * both edges, and dropped underneath if there is not the room above -- the
   * Visual section is near the bottom of a long list, so "above" is usually
   * fine and occasionally is not.
   */
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    const pop = popRef.current;
    if (!b || !pop) return;
    const { offsetWidth: w, offsetHeight: h } = pop;
    const above = b.top - GAP - h;
    pop.style.top = `${above < MARGIN ? b.bottom + GAP : above}px`;
    pop.style.left = `${Math.max(
      MARGIN,
      Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - MARGIN),
    )}px`;
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    /*
     * Dismiss on a press anywhere else, captured on the way down. Capture
     * rather than bubble, because the settings panel is a field of buttons and
     * several of them act on pointerdown: a bubbling listener would be asking
     * to run after the thing it was meant to close over had already happened.
     */
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    /*
     * And on a scroll, because the panel is fixed to the window and the list
     * behind it is not -- it would otherwise sit still while the row it
     * belongs to slid away underneath. Capture again, since the scroll is the
     * sheet body's and does not bubble to the window.
     */
    const gone = () => setOpen(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', gone, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const tiles: TileProps[] =
    kind === 'app'
      ? [
          { style: 'default', tuner: 'box', mode, label: 'Default' },
          { style: 'modern', tuner: 'box', mode, label: 'Modern' },
        ]
      : /*
         * Every tuner tile is drawn in Default, and that is not a shortcut.
         * The reader of this popup is deciding how big the screen should be,
         * and drawing three of them in a style they may not own would be
         * answering a question they did not ask with one they cannot act on.
         */
        [
          { style: 'default', tuner: 'box', mode, label: 'Box' },
          { style: 'default', tuner: 'long', mode, label: 'Long' },
          { style: 'default', tuner: 'full', mode, label: 'Full' },
        ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="info__btn"
        aria-label={
          kind === 'app' ? 'What the app styles look like' : 'What the tuner sizes look like'
        }
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <InfoIcon size={14} />
      </button>
      {open &&
        createPortal(
          <div className="info__pop" role="dialog" ref={popRef}>
            {tiles.map((t) => (
              <Tile key={t.label} {...t} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
