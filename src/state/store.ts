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
 * Four themes, two of which are not palettes of their own.
 *
 * One is dark with every hue drained out of it and nothing else changed — same
 * lightness values, same moulding. The other is that with the moulding taken
 * off as well: no box around a settings row, a tuning, a corner button or a
 * string. The signal colors survive both; they mean something.
 *
 * Which id is which is the confusing part, and deliberately so — see THEMES.
 */
export type ThemeMode = 'plain' | 'basic' | 'dark' | 'light' | 'modern';

/*
 * Every theme on offer, in the order the picker shows them.
 *
 * **The two colourless ids read backwards on purpose.** `plain` is the one
 * with the boxes and is labelled "Basic"; `basic` is the one without them
 * and is labelled "Plain". The names were swapped and the ids were not,
 * because swapping the ids would have meant migrating every stored setting
 * and getting it wrong would silently change the theme under anyone already
 * using one. The labels live in SettingsSheet and the CSS flag is
 * `data-bare`, which is named for what it does instead.
 */
export const THEMES: ThemeMode[] = ['plain', 'basic', 'dark', 'light', 'modern'];
export type ToleranceCents = 2 | 5 | 10 | 20;

/**
 * How heavy the field's trail is drawn, as a multiplier.
 *
 * A multiplier rather than a width, because the trail does not have one
 * width: it tapers from three pixels under the nib to one at the bottom of
 * the screen, which is what makes it read as falling away rather than as a
 * line. Scaling keeps that taper; setting a width would flatten it.
 */
export type TrailWidth = 0.6 | 1 | 1.6;

/** Every trail weight on offer, in the order the picker shows them. */
export const TRAIL_WIDTHS: TrailWidth[] = [0.6, 1, 1.6];

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
  /** Weight of the field's trail — see TrailWidth. */
  trailWidth: TrailWidth;
  /** Auto-detect which string is being played. */
  auto: boolean;
  /** Jump to the next untuned string once one lands. */
  autoAdvance: boolean;
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
  /*
   * What the screen shows, all of it paid.
   *
   * Every one of these hides something rather than adding it, which is the
   * shape the tier takes here: the free app is the complete instrument and
   * what money buys is the right to strip it back to the parts you use.
   * They are stored as `show*` and default to true, so a build that has
   * never been paid for looks exactly as it always did.
   */
  /** The wordmark across the top. Hidden without moving anything else. */
  showWordmark: boolean;
  /** The A440 / tolerance / capo strip. Hidden the same way. */
  showStatus: boolean;
  /** The big note and its two chromatic neighbours, above the tuner. */
  showCarousel: boolean;
  /** The "Too sharp" / "Too flat" line under the carousel. */
  showVerdict: boolean;
  /**
   * The instrument-face furniture on the tuner screens.
   *
   * The accidental marks down the sides, the small print in the corners,
   * and the note names along the top of the field. Not the readings: the
   * strobe keeps its note and cents, and the field keeps its cents, because
   * those are what the tuner is *for* and an instrument with no numbers on
   * it is a decoration.
   */
  showTunerMarks: boolean;
  /** The two pager arrows either side of the tuner screen. */
  showTunerArrows: boolean;
  /** Which tuner screen is on show — see components/visuals. */
  visual: VisualId;
  /**
   * Whether the paid tier is owned — see state/unlock.
   *
   * Defaults to *on*, and that is deliberate and temporary: there is no store
   * to buy it from yet, so leaving it off would lock the app's author out of
   * the app. The switch for it lives at the bottom of Settings and both go
   * before this ships anywhere real.
   */
  owned: boolean;
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
  trailWidth: 1,
  auto: true,
  autoAdvance: false,
  chimeOnTuned: false,
  haptics: false,
  keepAwake: true,
  theme: 'plain',
  hue: DEFAULT_HUE,
  leftHanded: false,
  capo: 0,
  inputDeviceId: 'default',
  showWordmark: true,
  showStatus: true,
  showCarousel: true,
  showVerdict: true,
  showTunerMarks: true,
  showTunerArrows: true,
  visual: DEFAULT_VISUAL,
  owned: false,
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
/**
 * Settings written before the app had its name.
 *
 * The keys were `opustuner.*`. Renaming them without this would silently empty
 * the settings of anyone already running the web app, custom tunings included,
 * and would look exactly like a bug. Read the old key once, write it forward,
 * and take the old one away.
 */
function adoptLegacy(key: string): string | null {
  const legacy = key.replace('easyastuning.', 'opustuner.');
  if (legacy === key) return null;
  try {
    const raw = localStorage.getItem(legacy);
    if (raw === null) return null;
    localStorage.setItem(key, raw);
    localStorage.removeItem(legacy);
    return raw;
  } catch {
    return null;
  }
}

function hydrate<T extends object>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key) ?? adoptLegacy(key);
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
  'easyastuning.settings.v1',
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
    // Same guard as the tolerance above: a stored value that is no longer on
    // offer would leave the picker showing no selection at all.
    trailWidth: TRAIL_WIDTHS.includes(s.trailWidth)
      ? s.trailWidth
      : DEFAULT_SETTINGS.trailWidth,
    // 'system', and later 'simple', were dropped from the picker; anyone still
    // holding one would otherwise sit on a theme with no button, exactly as
    // with the tolerance above.
    theme: THEMES.includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
  }),
);
export const sessionStore = createStore<Session>('easyastuning.session.v1', DEFAULT_SESSION);

/* ----------------------------------------------------------------- hooks -- */

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}

export function useSession(): Session {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

/*
 * The three sensitivity mappings that used to live here are gone, along with
 * the setting they read. The detector's silence gate is measured from the room
 * now — see the noise floor in audio/AudioEngine — and its clarity floor is a
 * constant on the engine, so neither is anyone's to set any more.
 */

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
