/**
 * Tactile feedback, through whichever channel the platform actually has.
 *
 * This lived in audio/tone.ts and called `navigator.vibrate` alone, which
 * meant the Vibration setting did nothing whatsoever on the one platform this
 * app is being shipped to: iOS has never implemented the Vibration API, in
 * Safari or in a web view. The switch sat in Settings, it turned on, and it
 * was wired to a function that is not there.
 *
 * Inside the packaged app the Taptic Engine is reachable, and it is a
 * different kind of thing: not a duration in milliseconds but one of a few
 * named taps. The two cannot take the same argument, so callers ask for a
 * weight and each path spells that its own way.
 */

import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { isNative } from './platform';

/** How hard the tap should feel, independent of how it is produced. */
export type Weight = 'light' | 'medium';

/** Web patterns, for the platforms that take one. */
const PATTERN: Record<Weight, number[]> = {
  light: [14, 40, 14],
  medium: [18, 55, 18, 55, 32],
};

/**
 * Fires and forgets. Every one of these confirms something the user can
 * already see, so a failure has nothing to report and nothing to retry.
 */
export function haptic(weight: Weight = 'light'): void {
  if (isNative()) {
    void Haptics.impact({
      style: weight === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light,
    }).catch(() => {
      /* no engine, or system haptics are off */
    });
    return;
  }

  try {
    navigator.vibrate?.(PATTERN[weight]);
  } catch {
    /* unsupported, which on iOS means always */
  }
}
