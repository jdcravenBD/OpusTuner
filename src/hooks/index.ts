import { useEffect, useMemo, useRef, useState } from 'react';
import { tuner, type TunerEvent, type TunerFrame } from '../tuner/TunerController';
import {
  BUILTIN_TUNINGS,
  CHROMATIC_TUNING,
  DEFAULT_TUNING_ID,
  getBuiltinTuning,
  type Tuning,
} from '../music/tunings';
import { isTuningLocked } from '../state/unlock';
import {
  sensitivityToClarity,
  sensitivityToRmsGate,
  useSession,
  useSettings,
  type ThemeMode,
} from '../state/store';

/**
 * Subscribes to the tuner's animation-frame stream.
 *
 * The callback is stored in a ref so a component can close over fresh props
 * without re-subscribing (and without the callback identity forcing churn in
 * the hot loop).
 */
export function useTunerFrame(callback: (frame: TunerFrame) => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => tuner.onFrame((frame) => ref.current(frame)), []);
}

/** Subscribes to discrete tuner events (string tuned, target changed, …). */
export function useTunerEvent(callback: (event: TunerEvent) => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => tuner.onEvent((event) => ref.current(event)), []);
}

/** Re-renders on any tuner event — for the string row and status chips. */
export function useTunerVersion(): number {
  const [version, setVersion] = useState(0);
  useTunerEvent(() => setVersion((v) => v + 1));
  return version;
}

/* --------------------------------------------------------------- tunings -- */

/** Every tuning the user can choose from, built-ins plus their own. */
export function useAllTunings(): Tuning[] {
  const { customTunings } = useSession();
  return useMemo(() => [...BUILTIN_TUNINGS, ...customTunings], [customTunings]);
}

/** The currently selected tuning, falling back to chromatic if it vanished. */
/**
 * Where an unresolvable or unaffordable tuning lands.
 *
 * This used to be the chromatic tuner, which was a sensible answer while the
 * chromatic tuner was free and is a hole now that it is not: a custom tuning
 * deleted from under the stored id would have handed it over for nothing.
 */
const FALLBACK_TUNING = getBuiltinTuning(DEFAULT_TUNING_ID) ?? CHROMATIC_TUNING;

export function useCurrentTuning(): Tuning {
  const { tuningId, customTunings } = useSession();
  const { owned } = useSettings();
  return useMemo(() => {
    const found =
      getBuiltinTuning(tuningId) ?? customTunings.find((t) => t.id === tuningId) ?? null;
    /*
     * Checked here rather than only on the list row that selects it. The row
     * is how a tuning is normally reached, but it is not the only way one can
     * end up stored: a session saved while the tier was owned, or from a build
     * where the tuning was free, would otherwise keep working forever.
     */
    if (!found || isTuningLocked(found, owned)) return FALLBACK_TUNING;
    return found;
  }, [tuningId, customTunings, owned]);
}

/* ----------------------------------------------------------------- theme -- */

/**
 * Applies theme and hue to <html>, following the OS when set to "system".
 *
 * The two hues are written as inline custom properties, which beats the
 * stylesheet's defaults for both light and dark without needing a copy per
 * theme. The browser chrome color is then read back off the resolved body
 * background rather than hard-coded, so it tracks any hue automatically.
 */
export function useAppearance(mode: ThemeMode, hue: number): void {
  useEffect(() => {
    const root = document.documentElement;
    // Two variables, one number. The tokens stay split so the screen *could*
    // be tinted apart from the chassis; the setting no longer offers to.
    root.style.setProperty('--h', String(hue));
    root.style.setProperty('--fh', String(hue));
  }, [hue]);

  useEffect(() => {
    const root = document.documentElement;
    /*
     * `plain` rides on dark's tokens and drains the hue out of them in CSS, so
     * it resolves to `dark` here and carries a flag of its own. Doing it as a
     * palette of its own would mean maintaining a second copy of every
     * lightness value to no end: the numbers are the same, the color is not.
     */
    /*
     * `basic` carries the drain too and adds a flag of its own, the way the
     * deleted `simple` theme did: it is plain with the moulding taken off,
     * not a second set of greys that happen to look similar.
     */
    const colorless = mode === 'plain' || mode === 'basic';
    root.dataset.theme = colorless ? 'dark' : mode;
    if (colorless) root.dataset.plain = 'true';
    else delete root.dataset.plain;
    if (mode === 'basic') root.dataset.basic = 'true';
    else delete root.dataset.basic;

    // Tints the browser's own chrome to match, so the app does not sit in a
    // band of someone else's color on a phone.
    const chrome = getComputedStyle(document.body).backgroundColor;
    if (chrome) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome);
    }
  }, [mode, hue]);
}

/* ------------------------------------------------------------- wake lock -- */

/**
 * Keeps the screen on while tuning. Re-acquires on visibility change because
 * the lock is dropped whenever the page is backgrounded.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* denied, low battery, or unsupported — not worth surfacing */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}

/* ----------------------------------------------------------- misc helpers -- */

/** Calls `onClose` when Escape is pressed. */
export function useEscape(active: boolean, onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/** Keeps settings in sync with the controller's plain-object mirrors. */
export function useSyncControllerSettings(): void {
  const settings = useSettings();
  useEffect(() => {
    tuner.a4 = settings.a4;
    tuner.tolerance = settings.tolerance;
    tuner.auto = settings.auto;
    tuner.autoAdvance = settings.autoAdvance;
    // sensitivity 0 (permissive, noisy room) .. 1 (strict, quiet room)
    tuner.engine.clarityThreshold = sensitivityToClarity(settings.sensitivity);
    tuner.engine.rmsGate = sensitivityToRmsGate(settings.sensitivity);
  }, [
    settings.a4,
    settings.tolerance,
    settings.auto,
    settings.autoAdvance,
    settings.sensitivity,
  ]);
}
