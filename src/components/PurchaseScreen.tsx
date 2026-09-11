import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronLeftIcon } from './Icons';
import { useEscape } from '../hooks';
import { useSettings } from '../state/store';
import { SHOWCASE } from '../state/showcase';
import {
  buyFullSet,
  getStore,
  lastPurchaseFailure,
  restoreFullSet,
  type Outcome,
} from '../state/purchases';
import { PRICE, TIER_HIGHLIGHTS, TIER_NAME, TIER_STATEMENT } from '../state/unlock';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * What the reader reached for, if anything.
   *
   * Taken by this component and not used by it any more. The screen used to
   * open with a line naming the control that was pressed, which was answering
   * a question the reader had already answered for themselves — they know
   * what they pressed. The three lines on the card cover every one of the ten
   * ways in, which is the same job done once instead of ten times.
   */
  wanted?: string | null;
}

/** Matches the exit keyframes below. */
const EXIT_MS = 200;

/**
 * The showcase, and the only place the app ever asks for money.
 *
 * **Always in the Modern style**, whichever style the app is in, and in the
 * light or dark the reader chose. It is the one screen that is not the tuner:
 * it is a page about a product, the platform has a well-worn look for pages
 * about products, and borrowing it here costs nothing the app needs. The
 * palette comes from the same token block the Modern theme uses -- see
 * `.purchase` in the stylesheet, which is named alongside
 * `:root[data-theme='modern']` so there is exactly one set of numbers.
 *
 * A full screen rather than a panel, because a panel that covers most of the
 * app while leaving a strip of it visible reads as an interruption to get
 * past.
 */
export function PurchaseScreen({ open, onClose }: Props) {
  const { themeMode } = useSettings();
  const [closing, setClosing] = useState(false);
  /** What is happening, so the line under the button can say it. */
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [result, setResult] = useState<{ outcome: Outcome; from: 'buy' | 'restore' } | null>(
    null,
  );
  /*
   * The store's own price, which is the localised one and the only one that
   * is true in every country. PRICE is the fallback for a store that cannot
   * be reached — a number on the screen beats a gap where one should be.
   */
  const [storePrice, setStorePrice] = useState<string | null>(null);

  /* Same shape as Sheet: adjusted during render so the screen is mounted on
     the commit `open` turns true, and starts its exit without a frame of
     nothing in between. */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setClosing(false);
      setBusy(null);
      setResult(null);
    } else {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  /* Asked once each time the screen opens, and ignored if it closes first. */
  useEffect(() => {
    if (!open) return;
    let live = true;
    void getStore()
      .price()
      .then((p) => live && setStorePrice(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open]);

  const run = async (from: 'buy' | 'restore') => {
    if (busy) return;
    setBusy(from);
    setResult(null);
    const outcome = from === 'buy' ? await buyFullSet() : await restoreFullSet();
    setBusy(null);
    setResult({ outcome, from });
    // Nothing more to sell. Let them see it land, then get out of the way.
    if (outcome === 'owned') setTimeout(onClose, 900);
  };

  useEscape(open, onClose);

  if (!open && !closing) return null;

  const host = document.getElementById('app') ?? document.body;

  return createPortal(
    <div
      className="purchase"
      /*
       * The mode, and only the mode. The style is not read: this screen is
       * Modern in both, so asking would be asking a question whose answer is
       * thrown away.
       */
      data-mode={themeMode}
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={TIER_NAME}
    >
      <Gallery />

      {/* Over the gallery, in the corner a back button lives in. */}
      <button className="purchase__back" onClick={onClose} aria-label="Back">
        <ChevronLeftIcon size={22} />
      </button>

      <div className="purchase__body">
        {/*
          * Two sentences, and the second is the one that matters.
          *
          * Every screen shaped like this one says some version of "cancel
          * anytime", because every screen shaped like this one is selling a
          * subscription. The reader arrives braced for that. Saying the
          * opposite plainly, in the largest type on the page, answers it
          * before the price is read rather than after.
          */}
        <p className="purchase__statement">
          {TIER_STATEMENT[0]}
          <br />
          {TIER_STATEMENT[1]}
        </p>

        <section className="purchase__card">
          <header className="purchase__card-head">
            <h1 className="purchase__card-name">{TIER_NAME}</h1>
            <div className="purchase__card-price">
              {storePrice ?? PRICE}
              {/* Quieter than the number, because it is the reassuring half
                  rather than the surprising one. */}
              <span className="purchase__lifetime">Lifetime</span>
            </div>
          </header>

          <ul className="purchase__perks">
            {TIER_HIGHLIGHTS.map((line) => (
              <li className="purchase__perk" key={line}>
                <CheckIcon size={13} />
                {line}
              </li>
            ))}
          </ul>

          <button
            className="purchase__buy"
            onClick={() => void run('buy')}
            disabled={busy !== null}
          >
            {busy === 'buy' ? 'Contacting the App Store' + ELLIPSIS : `Purchase ${TIER_NAME}`}
          </button>
        </section>

        <div
          className="purchase__status"
          data-shown={result !== null}
          data-good={result?.outcome === 'owned'}
          role="status"
        >
          {statusLine(result)}
        </div>

        {/*
          * The way back in for someone who has already paid: a new phone, a
          * reinstall, a restored backup. Apple requires this for a
          * non-consumable purchase and rejects without it (review guideline
          * 3.1.1), and it has to be reachable without paying a second time.
          */}
        <button
          className="purchase__restore"
          onClick={() => void run('restore')}
          disabled={busy !== null}
        >
          {busy === 'restore' ? 'Checking' + ELLIPSIS : 'Already bought it? Restore'}
        </button>
      </div>
    </div>,
    host,
  );
}

/**
 * The pictures, as a strip that snaps.
 *
 * Scroll-snap rather than a carousel library or a transform driven from
 * state: the browser already does momentum, rubber-banding at the ends and
 * the snap itself, and every one of those is worse when it is reimplemented.
 * The only thing React is told is which frame ended up under the finger, and
 * that is only so the dots can say so.
 */
function Gallery() {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const onScroll = () => {
      // Round rather than floor: the frame the strip has settled *nearest* is
      // the one being looked at, and a floor marks the new frame only once
      // the old one is completely gone.
      const next = Math.round(strip.scrollLeft / strip.clientWidth);
      setAt((prev) => (prev === next ? prev : next));
    };
    strip.addEventListener('scroll', onScroll, { passive: true });
    return () => strip.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="purchase__gallery">
      <div className="purchase__frames" ref={ref}>
        {SHOWCASE.map((frame) => (
          <div
            className="purchase__frame"
            key={frame.title}
            data-empty={frame.src === null}
            style={
              frame.src
                ? { backgroundImage: `url(${import.meta.env.BASE_URL}showcase/${frame.src})` }
                : undefined
            }
            role="img"
            aria-label={frame.title}
          >
            {/* Only while there is no picture — see state/showcase. */}
            {!frame.src && <span className="purchase__frame-name">{frame.title}</span>}
          </div>
        ))}
      </div>

      {/*
        * The page behind, brought up over the bottom of the picture.
        *
        * A picture that stops at an edge reads as pasted on; one that dissolves
        * into the page reads as part of it. It also gives the dots a ground
        * dark or light enough to be seen against, whatever the frame under
        * them happens to be.
        */}
      <div className="purchase__veil" aria-hidden />

      {SHOWCASE.length > 1 && (
        <div className="purchase__dots" aria-hidden>
          {SHOWCASE.map((frame, i) => (
            <span className="purchase__dot" key={frame.title} data-on={i === at} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Written as a character rather than typed, so the source stays ASCII. */
const ELLIPSIS = '…';

/**
 * Adds the store's own words when there are any.
 *
 * Blunt, and right for now: this is the only way to read a StoreKit error on
 * a handset, and "it did not work" with no reason is useless to everybody,
 * the person holding the phone included. Worth softening once the purchase
 * has been seen to work on a device.
 */
function withReason(line: string): string {
  const reason = lastPurchaseFailure();
  return reason ? `${line} (${reason})` : line;
}

/**
 * What the line under the button says.
 *
 * A cancelled purchase is not a failure and must not be dressed as one — the
 * reader chose that, and telling them something went wrong when they simply
 * changed their mind reads as a nag. It falls back to the standing line.
 */
function statusLine(result: { outcome: Outcome; from: 'buy' | 'restore' } | null): string {
  if (!result) return 'One payment. It never becomes a subscription.';
  switch (result.outcome) {
    case 'owned':
      return result.from === 'buy' ? 'Bought. Everything is open.' : 'Found it. Everything is open.';
    case 'cancelled':
      return 'One payment. It never becomes a subscription.';
    case 'nothing-to-restore':
      return 'Nothing on this Apple ID to restore.';
    case 'pending':
      return 'Waiting on approval. It will unlock by itself once it comes.';
    case 'unavailable':
      return withReason('The App Store is not available here yet.');
    default:
      return withReason('That did not go through. Nothing has been charged.');
  }
}
