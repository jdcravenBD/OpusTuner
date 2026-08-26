import { Sheet } from './Sheet';
import { LockIcon } from './Icons';
import { TIER_FEATURES, TIER_NAME } from '../state/unlock';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * What the reader just tried to use, if anything. Named rather than
   * described, so the sheet answers the question they actually asked instead
   * of opening with a pitch.
   */
  wanted?: string | null;
}

/**
 * What the paid tier is, shown when somebody reaches for a part of it.
 *
 * Deliberately not a wall. It arrives *after* a tap, names the thing that was
 * tapped, and lists what else comes with it — the reader has already told you
 * what they want, so leading with anything else is a waste of their attention
 * and yours.
 */
export function UnlockSheet({ open, onClose, wanted }: Props) {
  return (
    <Sheet open={open} title={TIER_NAME} onClose={onClose} stacked>
      <div className="sheet__section">
        <div className="unlock__lede">
          {/* Apposition rather than a verb, because `wanted` is sometimes
              singular ("Drop D") and sometimes plural ("Color themes") and
              nothing agrees with both. */}
          {wanted ? (
            <>
              <b>{wanted}</b> &mdash; part of {TIER_NAME}.
            </>
          ) : (
            <>Everything the tuner can do, in one purchase.</>
          )}
        </div>

        <ul className="unlock__list">
          {TIER_FEATURES.map((f) => (
            <li className="unlock__item" key={f.title}>
              <div className="unlock__item-name">{f.title}</div>
              <div className="unlock__item-desc">{f.detail}</div>
            </li>
          ))}
        </ul>

        {/*
          * No price and no button yet: there is nowhere to send the money.
          * Saying so is better than a control that does nothing, and better
          * than pretending the tier is further along than it is.
          */}
        <div className="unlock__soon">
          <LockIcon size={14} />
          Not on sale yet — everything here is still being built.
        </div>
      </div>
    </Sheet>
  );
}
