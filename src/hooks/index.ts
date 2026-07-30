import { useEffect, useMemo, useRef, useState } from 'react';
import { tuner, type TunerEvent, type TunerFrame } from '../tuner/TunerController';
import {
  BUILTIN_TUNINGS,
  CHROMATIC_TUNING,
  getBuiltinTuning,
  type Tuning,
} from '../music/tunings';
import { useSession, useSettings, type ThemeMode } from '../state/store';

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
export function useCurrentTuning(): Tuning {
  const { tuningId, customTunings } = useSession();
  return useMemo(
    () =>
      getBuiltinTuning(tuningId) ??
      customTunings.find((t) => t.id === tuningId) ??
      CHROMATIC_TUNING,
    [tuningId, customTunings],
  );
}

/* ----------------------------------------------------------------- theme -- */

/** Applies the theme to <html> and follows the OS when set to "system". */
export function useTheme(mode: ThemeMode): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const resolved = mode === 'system' ? (media.matches ? 'light' : 'dark') : mode;
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'light' ? '#F4F6FA' : '#0B0E14');
    };
    apply();
    if (mode !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);
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

/** Locks body scroll while a sheet is open. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

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
    tuner.engine.clarityThreshold = 0.42 + settings.sensitivity * 0.4;
    tuner.engine.rmsGate = 0.0012 + settings.sensitivity * 0.006;
  }, [
    settings.a4,
    settings.tolerance,
    settings.auto,
    settings.autoAdvance,
    settings.sensitivity,
  ]);
}
