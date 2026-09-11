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
import { useSession, useSettings, type ThemeMode, type ThemeStyle } from '../state/store';

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
 * Applies the three appearance settings, and the hue, to <html>.
 *
 * The two hues are written as inline custom properties, which beats the
 * stylesheet's defaults for both light and dark without needing a copy per
 * theme. The browser chrome color is then read back off the resolved body
 * background rather than hard-coded, so it tracks any hue automatically.
 */
export function useAppearance(
  style: ThemeStyle,
  mode: ThemeMode,
  colored: boolean,
  hue: number,
): void {
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
     * Modern is a palette *and* a structure, so it takes the data-theme slot
     * outright rather than sitting on top of one of the two palettes. It is
     * light and only light, which is why the mode is not consulted here: the
     * setting is kept for when the style changes back, not applied now.
     */
    root.dataset.theme = style === 'modern' ? 'modern' : mode;
    /*
     * Draining the colour is a flag rather than a palette of its own, because
     * that is what it is: the same theme with `--s` at zero. A second set of
     * lightness values that happened to match would be two things to keep in
     * step for no gain — the numbers are the same, the colour is not.
     *
     * Modern is exempt because it has no hue to drain: every colour in it is
     * a literal, so the flag would be a no-op that read as if it did something.
     */
    if (!colored && style !== 'modern') root.dataset.plain = 'true';
    else delete root.dataset.plain;

    // Tints the browser's own chrome to match, so the app does not sit in a
    // band of someone else's color on a phone.
    const chrome = getComputedStyle(document.body).backgroundColor;
    if (chrome) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome);
    }
  }, [style, mode, colored, hue]);
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
    // The detector's two floors are not here any more. The clarity threshold
    // is a constant on the engine and the silence gate is measured from the
    // room, so neither is a setting and neither belongs in this list.
  }, [settings.a4, settings.tolerance, settings.auto, settings.autoAdvance]);
}
