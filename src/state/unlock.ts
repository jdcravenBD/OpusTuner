/**
 * What costs money, and what does not.
 *
 * Everything the paid tier covers is decided here rather than at each call
 * site, so the policy can be read in one place and changed in one place.
 *
 * A word on enforcement: this is a web app with no server, and the flag that
 * says whether the tier is owned lives in localStorage like everything else.
 * Anyone who wants to edit it can. That is not what this module is for — it is
 * the plumbing that a real receipt check (StoreKit, Play Billing) can be wired
 * into later, and until then it is honest rather than enforced.
 */

import type { Tuning } from '../music/tunings';

/**
 * What the paid tier is called, everywhere it is named.
 *
 * A set of strings is the thing a player buys without thinking about it, and
 * "the full set" is already how they would describe having all of them. Kept
 * as one constant because names get slept on and changed.
 */
export const TIER_NAME = 'Full Set';

/**
 * What it costs, once.
 *
 * Written out rather than computed from a store, because there is no store
 * yet. When one arrives this becomes the localised price it hands back, and
 * every place that prints it already reads from here.
 */
export const PRICE = '$1.99';

/** Custom tunings you can keep without the full set. */
export const FREE_CUSTOM_TUNINGS = 1;

/**
 * The two appearance settings that cost something, and the free answer to each.
 *
 * **Light and dark are not on this list, and that is the point.** A tuner gets
 * used on a stage and in a bedroom, and charging for the one that does not
 * burn a hole in your night vision is charging for the app being usable. The
 * mode is free in both styles.
 *
 * What money buys is the *look*: the Modern style, and a palette dyed to a
 * colour of your choosing. Naming the free answer rather than listing the paid
 * ones means a style added later is paid by default, which is the safe way
 * round to be wrong.
 */
export const FREE_APPEARANCE = { themeStyle: 'default', themeColor: false };

/**
 * The claim the purchase screen leads with, as two sentences.
 *
 * Every paywall in this shape says some version of "cancel anytime", because
 * every paywall in this shape is a subscription. This one is not, and the
 * useful thing to say is the one those apps cannot: there is nothing to
 * cancel, and nothing that will come back next month. Kept here rather than
 * in the component because it is a claim about the product, and a claim about
 * the product has to stay true when the product changes.
 */
export const TIER_STATEMENT: [string, string] = ['Buy it once.', 'It stays bought.'];

/**
 * The three lines on the card, which between them cover every locked control.
 *
 * There are ten places in the app that can open the purchase screen and there
 * is no room for ten lines, so these are written as the three groups those
 * ten fall into: what you can tune, what it can look like, and what you can
 * take off the screen. Nobody arrives here having pressed something that none
 * of the three describes.
 */
export const TIER_HIGHLIGHTS: string[] = [
  'Every tuning, and the chromatic tuner',
  'The Modern style, and a color of your own',
  'A screen with only what you use',
];

/** True when this tuning needs the full set. */
export function isTuningLocked(tuning: Tuning, owned: boolean): boolean {
  if (owned || tuning.free) return false;
  // A custom tuning is gated by how many you have, not by which one it is —
  // see customTuningLimitReached.
  return !tuning.custom;
}

/**
 * True when saving another custom tuning needs the full set.
 *
 * Counted rather than flagged, so the one you already have keeps working
 * whichever it is, and stays editable.
 */
export function customTuningLimitReached(owned: boolean, existing: number): boolean {
  return !owned && existing >= FREE_CUSTOM_TUNINGS;
}

/** True when this appearance choice needs the full set. */
export function isAppearanceLocked(
  setting: keyof typeof FREE_APPEARANCE,
  value: string | boolean,
  owned: boolean,
): boolean {
  return !owned && value !== FREE_APPEARANCE[setting];
}
