/**
 * Tiny persisted store built on `useSyncExternalStore`.
 *
 * Deliberately not Redux/Zustand: the app has one small settings object and
 * one small session object, and the 60 fps needle path bypasses React entirely
 * (see `useFrameLoop`), so there is nothing here for a state library to earn.
 */

import { useSyncExternalStore } from 'react';
import type { NoteNaming } from '../music/notes';
import { DEFAULT_A4 } from '../music/notes';
import { DEFAULT_TUNING_ID, type Tuning } from '../music/tunings';
import { DEFAULT_VISUAL, VISUALS, type VisualId } from '../components/visuals/registry';

/* ----------------------------------------------------------------- types -- */

/**
 * Two colorless themes, differing in how far they go.
 *
 * `plain` is dark with every hue drained out of it and nothing else changed —
 * same lightness values, same moulding. `simple` takes that further: a pure
 * black chassis and no gradients anywhere, so every surface is flat. The
 * signal colors survive both; they mean something.
 */
export type ThemeMode = 'simple' | 'plain' | 'dark' | 'light';

/** Every theme on offer, in the order the picker shows them. */
export const THEMES: ThemeMode[] = ['simple', 'plain', 'dark', 'light'];
export type ToleranceCents = 2 | 5 | 10 | 20;

/** Every in-tune window on offer, in the order the picker shows them. */
export const TOLERANCES: ToleranceCents[] = [2, 5, 10, 20];

/** The stock blue-grey. Matches the hue baked into styles/app.css. */
export const DEFAULT_HUE = 215;

export interface Settings {
  /** Concert-pitch reference, 415–466 Hz. */
  a4: number;
  naming: NoteNaming;
  /** Half-width of the "in tune" window, in cents. */
  tolerance: ToleranceCents;
  /** Auto-detect which string is being played. */
  auto: boolean;
  /** Jump to the next untuned string once one lands. */
  autoAdvance: boolean;
  /** Play a reference tone when a string button is tapped. */
  referenceTones: boolean;
  /** Play a confirmation chime when a string lands in tune. */
  chimeOnTuned: boolean;
  haptics: boolean;
  keepAwake: boolean;
  theme: ThemeMode;
  /**
   * The one hue, 0–360. Drives every neutral in the chassis and on the tuner
   * screen alike.
   *
   * They used to be two, and nobody wants a tuner whose screen is a different
   * color from the case around it — the pair mostly gave you the chance to
   * make it look wrong.
   */
  hue: number;
  /** Mirror the string row for left-handed players. */
  leftHanded: boolean;
  /** Capo position in frets — raises every target by this many semitones. */
  capo: number;
  inputDeviceId: string;
  /** 0 = permissive (noisy rooms), 1 = strict (studio quiet). */
  sensitivity: number;
  showFrequency: boolean;
  /** The wordmark across the top. Hidden without moving anything else. */
  showWordmark: boolean;
  /** The A440 / tolerance / capo strip. Hidden the same way. */
  showStatus: boolean;
  /** Which tuner screen is on show — see components/visuals. */
  visual: VisualId;
}

export interface Session {
  tuningId: string;
  recentTuningIds: string[];
  favoriteTuningIds: string[];
  customTunings: Tuning[];
  /** Set once, shown never again — gates the first-run mic explainer. */
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  a4: DEFAULT_A4,
  naming: 'sharp',
  tolerance: 10,
  auto: true,
  autoAdvance: false,
  referenceTones: true,
  chimeOnTuned: false,
  haptics: false,
  keepAwake: true,
  theme: 'plain',
  hue: DEFAULT_HUE,
  leftHanded: false,
  capo: 0,
  inputDeviceId: 'default',
  sensitivity: 0.09,
  showFrequency: false,
  showWordmark: true,
  showStatus: true,
  visual: DEFAULT_VISUAL,
};

export const DEFAULT_SESSION: Session = {
  tuningId: DEFAULT_TUNING_ID,
  recentTuningIds: [DEFAULT_TUNING_ID],
  favoriteTuningIds: [],
  customTunings: [],
  onboarded: false,
};

/* ----------------------------------------------------------------- store -- */

export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

function createStore<T extends object>(
  key: string,
  initial: T,
  /** Runs once over the hydrated state — for values that were valid in an
   *  older build and are not any more. */
  migrate?: (state: T) => T,
): Store<T> {
  const hydrated = hydrate(key, initial);
  let state: T = migrate ? migrate(hydrated) : hydrated;
  const listeners = new Set<() => void>();

  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* private mode / quota — the app still works, it just won't remember */
    }
  };

  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k of Object.keys(next) as (keyof T)[]) {
        if (!Object.is(state[k], next[k])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...next };
      persist();
      listeners.forEach((l) => l());
    },
    reset() {
      state = { ...initial };
      persist();
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Merges stored values over the defaults so a new setting added in a later
 * version doesn't come back `undefined` for existing users.
 */
function hydrate<T extends object>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...initial };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...initial };
    const merged = { ...initial } as Record<string, unknown>;
    for (const k of Object.keys(initial as object)) {
      if (parsed[k] !== undefined && parsed[k] !== null) merged[k] = parsed[k];
    }
    return merged as T;
  } catch {
    return { ...initial };
  }
}

export const settingsStore = createStore<Settings>(
  'opustuner.settings.v1',
  DEFAULT_SETTINGS,
  (s) => ({
    ...s,
    // Someone who was last using a screen that has since been removed. Without
    // this the app falls back for *rendering* but the settings picker still
    // matches nothing, so it shows no selection at all.
    visual: VISUALS.some((v) => v.id === s.visual) ? s.visual : DEFAULT_VISUAL,
    // ±3¢ was dropped from the choices; anyone holding it would otherwise see
    // an in-tune window the settings panel shows no button for.
    tolerance: TOLERANCES.includes(s.tolerance) ? s.tolerance : DEFAULT_SETTINGS.tolerance,
    // 'system' was dropped from the picker; anyone holding it would otherwise
    // sit on a theme with no button, exactly as with the tolerance above.
    theme: THEMES.includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
  }),
);
export const sessionStore = createStore<Session>('opustuner.session.v1', DEFAULT_SESSION);

/* ----------------------------------------------------------------- hooks -- */

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}

export function useSession(): Session {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

/* ------------------------------------------------------- sensitivity map -- */

/*
 * The sensitivity slider drives two detector floors at once. They live here
 * rather than inline in the hook so the value shown on the slider is derived
 * from the same numbers the engine is actually given, and cannot drift.
 */

/**
 * RMS below which input is treated as silence.
 *
 * Only the bottom of the range has moved, from -58 dBFS to -68: the top end is
 * about rejecting a noisy room and already worked. The bottom end is what a
 * quiet room asks for, and at -58 dB it was the gate rather than the room that
 * decided a decaying note had finished.
 */
export function sensitivityToRmsGate(sensitivity: number): number {
  return 0.0004 + sensitivity * 0.0068;
}

/** Minimum NSDF peak height for a detection to be trusted. */
export function sensitivityToClarity(sensitivity: number): number {
  return 0.42 + sensitivity * 0.4;
}

/** The same gate expressed in dBFS, which is how it gets labelled. */
export function sensitivityToDb(sensitivity: number): number {
  return 20 * Math.log10(sensitivityToRmsGate(sensitivity));
}

/** Recents stay short enough to scan without scrolling past them. */
export const MAX_RECENT = 4;

/** Pushes a tuning to the front of the recents list, de-duplicated. */
/**
 * Switch to a tuning without touching the recents list.
 *
 * The two were one call, and they should not be: choosing from the sheet has
 * to change the tuner immediately, but re-sorting the list underneath the
 * finger moves the row that is still lit up confirming the tap. Recents are
 * committed separately, once the panel has gone.
 */
export function selectTuning(id: string): void {
  sessionStore.set({ tuningId: id });
}

export function markTuningUsed(id: string): void {
  sessionStore.set((s) => ({
    tuningId: id,
    recentTuningIds: [id, ...s.recentTuningIds.filter((t) => t !== id)].slice(0, MAX_RECENT),
  }));
}

export function toggleFavorite(id: string): void {
  sessionStore.set((s) => ({
    favoriteTuningIds: s.favoriteTuningIds.includes(id)
      ? s.favoriteTuningIds.filter((t) => t !== id)
      : [...s.favoriteTuningIds, id],
  }));
}
