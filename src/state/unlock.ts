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

/** Themes that need the tier. Plain, the colorless one, stays free. */
export const PAID_THEMES = ['dark', 'light'] as const;

/**
 * The things this is *not*, which for a paid app is half of what anyone wants
 * to know before they will read the rest.
 *
 * Stated as what it is rather than as a complaint about anyone else. Naming a
 * competitor in your own app reads as insecure, and it dates badly; saying
 * plainly that nothing here renews makes the same point and is the part a
 * reader can actually check.
 */
export const TIER_ASSURANCES: { title: string; detail: string }[] = [
  {
    title: 'No subscription',
    detail: 'It never renews, because there is nothing to renew.',
  },
  { title: 'No ads', detail: 'There have never been any, and there will not be.' },
  { title: 'No account', detail: 'Nothing to sign up for. Nothing leaves your phone.' },
  { title: 'Nothing expires', detail: 'Buy it once and it stays bought, on every device you own.' },
];

/** Everything the tier covers, in the order the purchase screen lists it. */
export const TIER_FEATURES: { title: string; detail: string }[] = [
  {
    title: 'The chromatic tuner',
    detail:
      'Tune anything at all, one note at a time, with no instrument chosen and\n      nothing assumed about what you are holding.',
  },
  {
    title: 'Every tuning',
    detail:
      'Drop, open, modal and cross tunings for guitar, bass, ukulele and banjo. Thirty-five beyond the standards.',
  },
  {
    title: 'Unlimited custom tunings',
    detail: 'Build and keep as many of your own as you like, not just the one.',
  },
  {
    title: 'Color themes',
    detail: 'Dark and Light, and the hue that tints the chassis and the tuner screen with them.',
  },
  {
    title: 'Hide the branding',
    detail: 'Turn off the wordmark across the top and keep the screen to yourself.',
  },
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

/** True when this theme needs the full set. */
export function isThemeLocked(theme: string, owned: boolean): boolean {
  return !owned && (PAID_THEMES as readonly string[]).includes(theme);
}
