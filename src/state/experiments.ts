/**
 * Five ideas, switchable, in the dev build only.
 *
 * Each of these is a judgement about feel, and a judgement about feel cannot
 * be made from a description or from a still picture -- it needs the app in
 * front of you with the thing on and then off again. So they ship behind
 * switches at the bottom of Settings, under the capture tools, and whichever
 * ones survive get folded in properly and lose their flag.
 *
 * ## Where they exist, and where they do not
 *
 * `npm run dev` and `npm run phone`, and nowhere else.
 *
 * The phone build matters more than the dev server here, and leaving it out
 * was the whole point of the switches missed: these are judgements about
 * feel, and feel is judged with a guitar in your hands, which means the
 * handset. `npm run phone` is a *production* build on purpose -- so the phone
 * sees what the store will -- which puts `import.meta.env.DEV` at false, so
 * a DEV-only guard excludes the one build they are for. `__PHONE_BUILD__` is
 * already in the codebase for exactly this shape of problem: it is how the
 * LAN build unlocks the paid tier, since `?dev` cannot reach it either.
 *
 * `npm run build` -- what Codemagic runs and what `cap sync` copies -- has
 * both constants false, so `useExperiments` folds to the frozen all-false
 * object and takes every branch below it. The panel is behind the same pair
 * at its call site, the way ScreensSection is behind DEV, so it never enters
 * the bundle at all.
 *
 * The store underneath is still real and still persists, because a switch you
 * have to set again on every reload is a switch you stop using.
 */

import { useSyncExternalStore } from 'react';
import { createStore } from './store';

export interface Experiments {
  /**
   * The half-second hold, drawn.
   *
   * The active string button fills from the bottom as `frame.hold` climbs, so
   * the wait before the tick appears is a countdown you can watch finish
   * rather than a delay you have to guess at.
   */
  holdFill: boolean;
  /**
   * A light sweeping across the string row when the last string lands.
   *
   * Finishing the instrument is the only outright triumphant moment the app
   * has and it currently passes in silence. Deliberately not a panel: the
   * original decision against marking this was about something standing in
   * front of the tuner, and a sweep occupies no space and blocks nothing.
   */
  allTunedSweep: boolean;
  /**
   * The verdict colour eased rather than switched.
   *
   * Sitting exactly on the tolerance makes the nib flick between two colours
   * on alternate frames. A tenth of a second of travel between them costs
   * nothing and removes it.
   */
  easeVerdict: boolean;
  /**
   * The note carousel arriving rather than appearing.
   *
   * Changing target rewrites the text in place. A short rise and fade in
   * makes a new note read as having arrived, which is most of the difference
   * between a readout and an instrument.
   */
  noteArrive: boolean;
  /**
   * Swipe up anywhere on the main screen to open the tunings.
   *
   * The panel is one small button in the corner of the bottom bar, and
   * changing tuning is a thing people do constantly. A gesture over the
   * whole screen is a much bigger target than a button, and costs no space.
   */
  swipeTunings: boolean;
}

const OFF: Readonly<Experiments> = Object.freeze({
  holdFill: false,
  allTunedSweep: false,
  easeVerdict: false,
  noteArrive: false,
  swipeTunings: false,
});

export const experimentStore = createStore<Experiments>('easyastuning.experiments.v1', {
  ...OFF,
});

/** Every flag, and every one of them false outside a dev build. */
export function useExperiments(): Experiments {
  const live = useSyncExternalStore(
    experimentStore.subscribe,
    experimentStore.get,
    experimentStore.get,
  );
  return import.meta.env.DEV || __PHONE_BUILD__ ? live : OFF;
}

/** The same answer for code that is not a component. */
export function experiments(): Experiments {
  return import.meta.env.DEV || __PHONE_BUILD__ ? experimentStore.get() : OFF;
}

/** Label and one line each, for the panel. Dropped with it from a store build. */
export const EXPERIMENTS: { key: keyof Experiments; name: string; desc: string }[] = [
  {
    key: 'holdFill',
    name: 'Hold countdown',
    desc: 'The active string fills as it waits out the half second before it counts.',
  },
  {
    key: 'allTunedSweep',
    name: 'All tuned sweep',
    desc: 'A light crosses the string row when the last string lands.',
  },
  {
    key: 'easeVerdict',
    name: 'Ease the verdict',
    desc: 'The nib travels between colours instead of snapping at the boundary.',
  },
  {
    key: 'noteArrive',
    name: 'Note arrives',
    desc: 'A new target rises into place rather than being rewritten where it stands.',
  },
  {
    key: 'swipeTunings',
    name: 'Swipe up for tunings',
    desc: 'A swipe up anywhere on the main screen opens the tunings panel.',
  },
];
