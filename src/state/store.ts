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
 * How the app is drawn, as three independent questions rather than one list.
 *
 * There was a single `theme` here with five entries, and most of them were the
 * same two or three answers combined: "Basic" was Dark with the colour drained
 * out of it, "Plain" was that again with the boxes taken off, and Modern was
 * the only one that was genuinely its own thing. A list like that grows by
 * multiplication — every new axis doubles it — and it cannot say what it
 * means: nothing in the word "Basic" tells you it is Dark underneath.
 *
 * Split, they are: which visual language (`themeStyle`), light or dark
 * (`themeMode`), and whether the palette is tinted at all (`themeColor`).
 */
export type ThemeStyle = 'default' | 'modern';
export type ThemeMode = 'dark' | 'light';

/** Both styles, in the order the picker shows them. */
export const THEME_STYLES: ThemeStyle[] = ['default', 'modern'];

/** Both modes, likewise. */
export const THEME_MODES: ThemeMode[] = ['dark', 'light'];
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
  /** Which visual language — see ThemeStyle. */
  themeStyle: ThemeStyle;
  /**
   * Light or dark.
   *
   * Ignored while the style is Modern, which is light and only light. The
   * setting is still kept rather than forced, so switching back to Default
   * returns the mode that was chosen before.
   */
  themeMode: ThemeMode;
  /**
   * Whether the palette is tinted at all.
   *
   * Off drains every hue out of it and changes nothing else: same lightness
   * values, same moulding, same gradients. Signal colours are literals and
   * survive it, because green still has to mean in tune.
   */
  themeColor: boolean;
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
  /** Tunings kept at the top of the list, under their own heading. */
  pinnedTuningIds: string[];
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
  // The free appearance, and the one the app has always opened in: the dark
  // palette with no colour in it. See FREE_APPEARANCE in state/unlock.
  themeStyle: 'default',
  themeMode: 'dark',
  themeColor: false,
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
  pinnedTuningIds: [],
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
  /**
   * Runs once over the hydrated state — for values that were valid in an
   * older build and are not any more.
   *
   * Handed the raw stored object as well, which is the only way to read a
   * setting that no longer exists: `hydrate` copies across the keys the
   * current Settings has and drops everything else, so by the time it returns,
   * a renamed or split setting is already gone.
   */
  migrate?: (state: T, stored: Readonly<Record<string, unknown>>) => T,
): Store<T> {
  const { state: hydrated, stored } = hydrate(key, initial);
  let state: T = migrate ? migrate(hydrated, stored) : hydrated;
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

function hydrate<T extends object>(
  key: string,
  initial: T,
): { state: T; stored: Readonly<Record<string, unknown>> } {
  try {
    const raw = localStorage.getItem(key) ?? adoptLegacy(key);
    if (!raw) return { state: { ...initial }, stored: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { state: { ...initial }, stored: {} };
    const merged = { ...initial } as Record<string, unknown>;
    for (const k of Object.keys(initial as object)) {
      if (parsed[k] !== undefined && parsed[k] !== null) merged[k] = parsed[k];
    }
    return { state: merged as T, stored: parsed as Record<string, unknown> };
  } catch {
    return { state: { ...initial }, stored: {} };
  }
}

/**
 * The one `theme` setting, as the three that replaced it.
 *
 * Anyone who has used this app before has a `theme` in storage and none of the
 * three keys below. Without this they would open the app to the default dark,
 * whichever theme they had chosen, and a paid theme they had bought would look
 * like it had been taken away.
 *
 * Two of the five map to the same answer, because that is what they were: both
 * colourless themes were the dark palette with the hue drained, differing only
 * in the moulding, and the one without it is gone. Modern keeps its style and
 * is given Light, which is what it has always actually looked like, so the
 * Mode row agrees with the screen.
 */
function appearanceFrom(
  stored: Readonly<Record<string, unknown>>,
  current: Settings,
): Pick<Settings, 'themeStyle' | 'themeMode' | 'themeColor'> {
  // Guarded the same way the tolerance below is: a stored value that is no
  // longer on offer would leave the picker showing no selection at all.
  const kept = {
    themeStyle: THEME_STYLES.includes(current.themeStyle)
      ? current.themeStyle
      : DEFAULT_SETTINGS.themeStyle,
    themeMode: THEME_MODES.includes(current.themeMode)
      ? current.themeMode
      : DEFAULT_SETTINGS.themeMode,
    themeColor: current.themeColor,
  };
  // Already migrated and saved since: the three keys are the truth now, and
  // whatever `theme` is still sitting beside them in storage is stale.
  if (stored.themeStyle !== undefined) return kept;
  switch (stored.theme) {
    case 'plain':
    case 'basic':
      return { themeStyle: 'default', themeMode: 'dark', themeColor: false };
    case 'dark':
      return { themeStyle: 'default', themeMode: 'dark', themeColor: true };
    case 'light':
      return { themeStyle: 'default', themeMode: 'light', themeColor: true };
    case 'modern':
      return { themeStyle: 'modern', themeMode: 'light', themeColor: false };
    default:
      return kept;
  }
}

export const settingsStore = createStore<Settings>(
  'easyastuning.settings.v1',
  DEFAULT_SETTINGS,
  (s, stored) => ({
    ...s,
    ...appearanceFrom(stored, s),
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
  }),
);
export const sessionStore = createStore<Session>(
  'easyastuning.session.v1',
  DEFAULT_SESSION,
  /*
   * Favourites became pins, and the stored key followed.
   *
   * Renaming it without this would quietly empty the list for everyone who
   * has one, which is the sort of loss nobody reports as a bug because it
   * looks like they never set it.
   */
  (s, stored) => {
    if (stored.pinnedTuningIds !== undefined || !Array.isArray(stored.favoriteTuningIds)) return s;
    return { ...s, pinnedTuningIds: stored.favoriteTuningIds as string[] };
  },
);

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

export function togglePin(id: string): void {
  sessionStore.set((s) => ({
    pinnedTuningIds: s.pinnedTuningIds.includes(id)
      ? s.pinnedTuningIds.filter((t) => t !== id)
      : [...s.pinnedTuningIds, id],
  }));
}
