import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, CloseIcon } from './Icons';
import { useEscape } from '../hooks';
import {
  buyFullSet,
  getStore,
  lastPurchaseFailure,
  restoreFullSet,
  type Outcome,
} from '../state/purchases';
import { PRICE, TIER_ASSURANCES, TIER_FEATURES, TIER_NAME } from '../state/unlock';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * What the reader reached for, if anything. Named at the top so the screen
   * answers the question they actually asked before it says anything else.
   */
  wanted?: string | null;
}

/** Matches the exit keyframes below. */
const EXIT_MS = 200;

/**
 * The showcase, and the only place the app ever asks for money.
 *
 * A full screen rather than a panel, because a panel that covers most of the
 * app while leaving a strip of it visible reads as an interruption to get past.
 * This is the one thing on screen, it closes with a single bare glyph in the
 * corner, and everything on it is either what you get or what you are not
 * being signed up for.
 */
export function PurchaseScreen({ open, onClose, wanted }: Props) {
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
    <div className="purchase" data-closing={closing} role="dialog" aria-modal="true" aria-label={TIER_NAME}>
      {/* Bare glyph, no bounds — the screen is the thing, not the chrome. */}
      <button className="purchase__close" onClick={onClose} aria-label="Close">
        <CloseIcon size={24} />
      </button>

      <div className="purchase__scroll">
        <div className="purchase__inner">
          <header className="purchase__head">
            <div className="purchase__eyebrow">One-time purchase</div>
            <h1 className="purchase__title">{TIER_NAME}</h1>
            <p className="purchase__lede">
              {wanted ? (
                <>
                  <b>{wanted}</b>, and everything else the tuner can do.
                </>
              ) : (
                <>Everything the tuner can do, unlocked for good.</>
              )}
            </p>
          </header>

          {/*
            * The contents of the set, above the price rather than below it.
            *
            * A strip of screenshots stood here, answering a question nobody
            * asks about a tuner. What a thing costs is only worth reading
            * once you know what it buys, so the list came up and the pictures
            * went.
            */}
          <section className="purchase__block purchase__block--gets">
            <h2 className="purchase__h2">What you get</h2>
            <ul className="purchase__gets">
              {TIER_FEATURES.map((f) => (
                <li className="purchase__get" key={f.title}>
                  <div className="purchase__get-name">{f.title}</div>
                  <div className="purchase__get-desc">{f.detail}</div>
                </li>
              ))}
            </ul>
          </section>

          {/*
            * The price and the word "once" are the same size on purpose. The
            * number is not the surprising part — that it is the only one ever
            * is.
            */}
          <div className="purchase__price">
            <span className="purchase__amount">{storePrice ?? PRICE}</span>
            <span className="purchase__once">once</span>
          </div>

          <button
            className="purchase__buy"
            onClick={() => void run('buy')}
            disabled={busy !== null}
          >
            {busy === 'buy' ? 'Contacting the App Store' + ELLIPSIS : `Unlock ${TIER_NAME}`}
          </button>

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

          {/*
            * And what the payment does not come with, directly under the
            * button that would take it — which is where the doubt is.
            */}
          <section className="purchase__block purchase__block--nots">
            <h2 className="purchase__h2">What you don&rsquo;t</h2>
            <ul className="purchase__nots">
              {TIER_ASSURANCES.map((a) => (
                <li className="purchase__not" key={a.title}>
                  <div className="purchase__not-name">
                    {a.title}
                    {/* A tick, because every one of these is a thing you are
                        being spared rather than a thing you are missing. */}
                    <CheckIcon size={13} />
                  </div>
                  <div className="purchase__not-desc">{a.detail}</div>
                </li>
              ))}
            </ul>
          </section>

          <p className="purchase__coda">
            A tuner is a tool, not a service. It should not arrive with a monthly bill.
          </p>
        </div>
      </div>
    </div>,
    host,
  );
}

/** Written as a character rather than typed, so the source stays ASCII. */
const ELLIPSIS = '\u2026';

/**
 * What the line under the button says.
 *
 * A cancelled purchase is not a failure and must not be dressed as one — the
 * reader chose that, and telling them something went wrong when they simply
 * changed their mind reads as a nag. It says nothing at all instead.
 */
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
