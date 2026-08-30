import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, CloseIcon } from './Icons';
import { useEscape } from '../hooks';
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
  const [tapped, setTapped] = useState(false);

  /* Same shape as Sheet: adjusted during render so the screen is mounted on
     the commit `open` turns true, and starts its exit without a frame of
     nothing in between. */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setClosing(false);
      setTapped(false);
    } else {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

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
            <span className="purchase__amount">{PRICE}</span>
            <span className="purchase__once">once</span>
          </div>

          <button className="purchase__buy" onClick={() => setTapped(true)}>
            Unlock {TIER_NAME}
          </button>

          <div className="purchase__status" data-shown={tapped}>
            {tapped
              ? 'Not on sale yet — the store is not wired up.'
              : 'One payment. It never becomes a subscription.'}
          </div>

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
