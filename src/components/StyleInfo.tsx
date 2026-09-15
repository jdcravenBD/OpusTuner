/**
 * The "what does this look like" button, and the real app it draws.
 *
 * Two of the appearance settings pick something you cannot see until you have
 * already picked it, which is a poor bargain for a paid control -- especially
 * Modern, which nobody without the tier can turn on to find out what they
 * would be buying. Each of those rows carries an info button, and the button
 * opens a row of phones, one per option.
 *
 * **They are the app, not a drawing of it.** Every tile is a 390x844 frame
 * running the same stylesheet, with the real chassis markup inside it -- the
 * same `.topbar`, `.carousel`, `.field-deck`, `.string` and `.tuning-btn`
 * classes the tuner renders -- and then scaled down with a transform. The
 * corner radii, the mouldings, the lit edges, the tuner screen's own size
 * budget and the whole column's spacing are not approximated: they are
 * computed by the same rules, from the same tokens, at the same size. A tile
 * follows the hue, the colour strength and the light/dark choice already in
 * force, and it cannot go stale.
 *
 * Nothing in them animates and nothing runs a detector. The screen's interior
 * is the one part drawn rather than run, because running it would mean five
 * more canvases on the frame loop. Everything around it is the instrument.
 *
 * **Why a frame and not a div.** A tile has to show a style the app is not
 * currently in, and the whole of Modern -- ninety-seven rules of it -- is
 * written `:root[data-theme='modern'] .thing`. `:root` is the document
 * element, so in one document there is exactly one answer to "which style is
 * this" and every tile gets it. It goes wrong both ways round: a Modern tile
 * in a Default app reaches none of those rules, and a Default tile in a
 * Modern app is dragged into all of them.
 *
 * A frame has its own document element, so each tile simply *is* the style it
 * is showing. Nothing is rewritten and nothing is duplicated -- which was the
 * alternative, and a second copy of a theme is the version that starts lying
 * about what you are buying the first time somebody changes a radius.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../hooks';
import { ChevronUpIcon, GearIcon, InfoIcon, ResetIcon } from './Icons';
import { Wordmark } from './Wordmark';
import type { ThemeMode, ThemeStyle, TunerStyle } from '../state/store';

/** Clearance from the button, and from the edges of the window. */
const GAP = 8;
const MARGIN = 10;

/** The handset a tile is laid out at, before the transform shrinks it. */
const PHONE_W = 390;
const PHONE_H = 844;

/**
 * A frame carrying the app's stylesheet and its own answer to "which style".
 *
 * The head is copied rather than linked: in a dev build the CSS is a handful
 * of injected `<style>` elements and in a packaged one it is a `<link>`, so
 * cloning whatever is actually there covers both. The `<base>` is what makes
 * the second case work at all -- a frame with no document of its own has no
 * address to resolve a relative href against.
 *
 * The root's inline properties go across as well. `--h` and `--s` are written
 * there by useAppearance and they are the hue and the colour strength, which
 * a preview has to follow or it is showing somebody else's app.
 */
function PhoneFrame({
  style,
  mode,
  children,
}: {
  style: ThemeStyle;
  mode: ThemeMode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dress = () => {
      const doc = ref.current?.contentDocument;
      if (!doc) return;
      doc.head.replaceChildren();
      const base = doc.createElement('base');
      base.href = document.baseURI;
      doc.head.append(base);
      for (const node of Array.from(
        document.head.querySelectorAll('style, link[rel="stylesheet"]'),
      )) {
        doc.head.append(node.cloneNode(true));
      }
      const root = doc.documentElement;
      root.style.cssText = document.documentElement.style.cssText;
      /*
       * The same three attributes useAppearance writes, and for the same
       * reasons -- Modern takes the theme slot outright and carries the mode
       * alongside, and `plain` is the colour switch. The tile is told which
       * style to be; everything else it copies from the app.
       */
      root.dataset.theme = style === 'modern' ? 'modern' : mode;
      if (style === 'modern') root.dataset.mode = mode;
      if (document.documentElement.dataset.plain) root.dataset.plain = 'true';
      setBody(doc.body);
    };
    dress();
    const el = ref.current;
    // A frame with no src is usually ready by now and occasionally is not.
    el?.addEventListener('load', dress);
    return () => el?.removeEventListener('load', dress);
  }, [style, mode]);

  return (
    <iframe ref={ref} className="pv__frame" title="" tabIndex={-1} scrolling="no" aria-hidden>
      {body && createPortal(children, body)}
    </iframe>
  );
}

/**
 * The tuner screen's face.
 *
 * The one thing here that is drawn rather than run. The cent gridlines, the
 * in-tune corridor and the falling rules are placed from the same numbers
 * PitchField uses -- a semitone either way, a line every fifty cents, a rule
 * every 38px, the marker at 0.28 of the way down -- so the screen reads at a
 * glance as the screen. The nib's outline is transcribed from nibPath rather
 * than shared with it, because that one draws into a canvas; if the marker is
 * ever redrawn, this is the copy that has to follow.
 */
function Face() {
  const lines = [-250, -200, -150, -100, -50, 50, 100, 150, 200, 250];
  /** xOf() in PitchField: a pad of 7.5% either side, then the cents scale. */
  const xOf = (c: number) => 50 + (c / 250) * 42.5;
  return (
    <div className="pv__face" aria-hidden>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pv__face-grid">
        {lines.map((c) => (
          <line
            key={c}
            x1={xOf(c)}
            x2={xOf(c)}
            y1="0"
            y2="100"
            stroke="var(--field-grid)"
            strokeWidth={c % 100 === 0 ? 0.5 : 0.3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <rect
          x={xOf(-10)}
          width={xOf(10) - xOf(-10)}
          y="0"
          height="100"
          fill="var(--green)"
          opacity="0.09"
        />
        <line
          x1="50"
          x2="50"
          y1="0"
          y2="100"
          stroke="var(--field-grid)"
          strokeWidth="0.7"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <svg viewBox="-16 -34 32 36" className="pv__nib">
        <path
          d="M0,0 C-1.8,-10.2 -9.1,-16.8 -13,-24 C-14.6,-30.9 -8.6,-30.9 0,-30.9 C8.6,-30.9 14.6,-30.9 13,-24 C9.1,-16.8 1.8,-10.2 0,0 Z"
          fill="var(--amber)"
        />
      </svg>
    </div>
  );
}

/**
 * The chassis, as App renders it, with nothing behind it.
 *
 * The title is switched off the way the app switches it off -- `wordmark--off`
 * takes it out of sight without taking it out of the layout -- so a tile shows
 * the spacing the app would actually have.
 */
function Chassis({ tuner }: { tuner: TunerStyle }) {
  return (
    <div className="app" data-tuner-style={tuner} data-intune="false">
      <header className="topbar">
        <Wordmark className="wordmark wordmark--off" />
        <div className="topbar__row">
          <button className="icon-btn" tabIndex={-1}>
            <GearIcon />
          </button>
          <button className="status" tabIndex={-1}>
            <span className="status__seg">
              <b>A</b>440
            </span>
            <span className="status__seg">±10¢</span>
            <span className="status__seg" data-on={false}>
              NO CAPO
            </span>
          </button>
          <button className="icon-btn" tabIndex={-1}>
            <ResetIcon />
          </button>
        </div>
      </header>

      <main className="stage">
        <div className="note-block">
          <div className="carousel" data-signal="false" data-intune="false" data-naming="sharp">
            <span className="carousel__note" data-dist="2">
              D
            </span>
            <span className="carousel__note" data-dist="1">
              D♯
            </span>
            <span className="carousel__note carousel__note--focus">
              <span>E</span>
              <span className="carousel__octave">2</span>
            </span>
            <span className="carousel__note" data-dist="1">
              F
            </span>
            <span className="carousel__note" data-dist="2">
              F♯
            </span>
          </div>
        </div>
        <div className="field-zone">
          <div className="verdict" data-state="idle">
            In tune
          </div>
          <div className="field-row">
            <div className="field-deck">
              <div className="field" data-screen="field" data-visual="field">
                <Face />
                <span className="field__edge field__edge--flat">♭</span>
                <span className="field__edge field__edge--sharp">♯</span>
                <span className="field__note field__note--bl">FIELD · ±250 ¢</span>
                <span className="field__note field__note--br">MPM</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <div className="strings">
        <div className="strings__inner">
          {['E', 'A', 'D', 'G', 'B', 'e'].map((n, i) => (
            <button
              key={n}
              className="string"
              data-active={i === 0}
              data-tuned={false}
              tabIndex={-1}
            >
              <span>
                {n}
                <span className="string__octave">{[2, 2, 3, 3, 3, 4][i]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <footer className="bottombar">
        <button className="tuning-btn" tabIndex={-1}>
          <span className="tuning-btn__text">
            <span className="tuning-btn__instrument">Guitar</span>
            <span className="tuning-btn__name">Standard</span>
          </span>
          <ChevronUpIcon />
        </button>
        <button className="toggle" data-on tabIndex={-1}>
          Auto
          <span className="toggle__track">
            <span className="toggle__knob" />
          </span>
        </button>
      </footer>
    </div>
  );
}

interface TileProps {
  /** Which visual language the tile draws itself in. */
  style: ThemeStyle;
  /** How the tuner screen is sized inside it. */
  tuner: TunerStyle;
  /** Light or dark, taken from the app rather than chosen here. */
  mode: ThemeMode;
  label: string;
}

function Tile({ style, tuner, mode, label }: TileProps) {
  return (
    <figure className="pv">
      <span className="pv__glass">
        <PhoneFrame style={style} mode={mode}>
          <Chassis tuner={tuner} />
        </PhoneFrame>
      </span>
      <figcaption className="pv__label">{label}</figcaption>
    </figure>
  );
}

interface Props {
  /** Which row this belongs to, and therefore what the tiles vary. */
  kind: 'app' | 'tuner';
  /** The style the app is in, which the tuner tiles are drawn in. */
  style: ThemeStyle;
  mode: ThemeMode;
}

export function StyleInfo({ kind, style, mode }: Props) {
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
   * both edges, and dropped underneath if there is not the room above.
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
          { style: 'default', tuner: 'small', mode, label: 'Default' },
          { style: 'modern', tuner: 'small', mode, label: 'Modern' },
        ]
      : /*
         * The tuner tiles take whatever style the app is already in, which
         * answers the question that used to need answering here: a reader who
         * has not bought the tier cannot be in Modern, so they see Default
         * without anything having to insist on it, and a reader who has sees
         * the app they actually own.
         */
        [
          { style, tuner: 'small', mode, label: 'Small' },
          { style, tuner: 'large', mode, label: 'Large' },
          { style, tuner: 'full', mode, label: 'Full' },
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
        <InfoIcon size={18} />
      </button>
      {open &&
        createPortal(
          <div
            className="info__pop"
            role="dialog"
            ref={popRef}
            /* The tiles are laid out at a handset's size and shrunk from
               there, so one number decides how big the row of them is. */
            style={
              {
                '--pv-w': `${PHONE_W}px`,
                '--pv-h': `${PHONE_H}px`,
                '--pv-scale': kind === 'app' ? 0.36 : 0.235,
              } as React.CSSProperties
            }
          >
            {tiles.map((t) => (
              <Tile key={t.label} {...t} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
