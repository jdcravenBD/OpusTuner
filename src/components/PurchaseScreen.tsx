import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon } from './Icons';
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
import {
  PRICE,
  TIER_DETAILS,
  TIER_HIGHLIGHTS,
  TIER_NAME,
  TIER_STATEMENT,
} from '../state/unlock';

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
  /** True the moment the page moves, which is when the hint has done its job. */
  const [moved, setMoved] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

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

  /*
   * The hint under the button only has to survive until it is taken.
   *
   * Watched on the first pixel rather than at some distance down, because the
   * thing it is telling you is *that* the page scrolls -- once it has moved,
   * you know, and a label still saying so is a label talking over you.
   */
  useEffect(() => {
    const page = bodyRef.current;
    if (!open || !page) return;
    setMoved(page.scrollTop > 0);
    const onScroll = () => setMoved(page.scrollTop > 0);
    page.addEventListener('scroll', onScroll, { passive: true });
    return () => page.removeEventListener('scroll', onScroll);
  }, [open]);

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
      ref={bodyRef}
    >
      {/* Over the gallery, in the corner a back button lives in. */}
      <button className="purchase__back" onClick={onClose} aria-label="Back">
        <ChevronLeftIcon size={22} />
      </button>

      {/*
        * Everything down to the hint, held to exactly one screenful.
        *
        * The pictures take whatever is left after the card rather than a
        * fixed share of the screen, which is the only way round that works:
        * the card is as tall as its own words, and a gallery sized as a
        * percentage pushed the button off the bottom of a small phone. This
        * way the button is always on the first screen and the pictures are
        * as big as the phone can afford.
        */}
      <div className="purchase__first">
        <Gallery />

        <div className="purchase__page">
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

          <div className="purchase__hint" data-gone={moved} aria-hidden>
            Scroll for details
            <ChevronDownIcon size={16} />
          </div>
        </div>
      </div>

      {/*
        * The long version.
        *
        * A reader who scrolls past the button is looking for a reason to
        * believe the four lines above it, and thirty of them counted out is a
        * better answer than four of them said again. Written as a grouped
        * list because that is what it is, and because this screen is in the
        * style where a grouped list is the way a list looks.
        */}
      <div className="purchase__details">
        {TIER_DETAILS.map((group) => (
          <section className="purchase__group" key={group.label}>
            <h2 className="purchase__group-label">{group.label}</h2>
            <ul className="purchase__rows">
              {group.rows.map(([name, note]) => (
                <li className="purchase__row" key={name}>
                  <span className="purchase__row-name">{name}</span>
                  {note && <span className="purchase__row-note">{note}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
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

    /*
     * Where the middle of each card sits along the strip.
     *
     * Measured once rather than divided out per scroll event, and measured at
     * all rather than computed: a card is narrower than the screen, there is a
     * gap between them and padding at both ends, so the old
     * `scrollLeft / clientWidth` was not the index of anything -- it marked
     * the fourth card when the strip was scrolled to the eighth.
     */
    let mids: number[] = [];
    const measure = () => {
      mids = Array.from(strip.children, (el) => {
        const box = el as HTMLElement;
        return box.offsetLeft + box.offsetWidth / 2;
      });
    };

    const onScroll = () => {
      if (!mids.length) return;
      // Content coordinates, the same space offsetLeft is in -- which is why
      // the strip is positioned in the stylesheet.
      const mid = strip.scrollLeft + strip.clientWidth / 2;
      let best = 0;
      for (let i = 1; i < mids.length; i++) {
        if (Math.abs(mids[i] - mid) < Math.abs(mids[best] - mid)) best = i;
      }
      setAt((prev) => (prev === best ? prev : best));
    };

    measure();
    /*
     * Park on the first card.
     *
     * The strip is padded by half its own width at each end so that the first
     * and last cards can both reach the middle, which means scroll position
     * zero is not the first card -- it is the empty half-width before it.
     * Doing it here rather than in CSS is what keeps the padding honest: no
     * arithmetic that has to guess how wide a card turned out.
     */
    if (mids.length) strip.scrollLeft = mids[0] - strip.clientWidth / 2;
    strip.addEventListener('scroll', onScroll, { passive: true });
    if (typeof ResizeObserver === 'undefined') {
      return () => strip.removeEventListener('scroll', onScroll);
    }
    // The cards are sized off the strip's height, so a rotation moves every
    // one of these.
    const observer = new ResizeObserver(() => {
      measure();
      onScroll();
    });
    observer.observe(strip);
    return () => {
      strip.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
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

      {/* Behind everything, and the only thing here that is not flat. */}
      <div className="purchase__glow" aria-hidden />

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
