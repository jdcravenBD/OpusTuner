/**
 * Which of the two apps this is.
 *
 * The same build runs in a browser and inside the packaged iOS app, and a
 * handful of decisions genuinely differ between them — a service worker, how
 * the microphone is started, whether vibration goes through the web API or
 * through the OS. Asking Capacitor directly at each of those sites would put
 * a native import into files that have no business knowing what a phone is,
 * so the question is asked here and answered as a boolean.
 *
 * Wrapped in try/catch because this is imported by modules that run before
 * anything is mounted, and in a plain browser tab Capacitor is present but has
 * no native bridge behind it.
 */

import { Capacitor } from '@capacitor/core';

let cached: boolean | null = null;

/** True inside the packaged app, false in any browser. */
export function isNative(): boolean {
  if (cached === null) {
    try {
      cached = Capacitor.isNativePlatform();
    } catch {
      cached = false;
    }
  }
  return cached;
}
