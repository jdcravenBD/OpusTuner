/**
 * Five ideas, switchable, in the dev build only.
 *
 * Each of these is a judgement about feel, and a judgement about feel cannot
 * be made from a description or from a still picture -- it needs the app in
 * front of you with the thing on and then off again. So they ship behind
 * switches at the bottom of Settings, under the capture tools, and whichever
 * ones survive get folded in properly and lose their flag.
 *
 * ## Why they are off in a production build, twice over
 *
 * `useExperiments` returns the frozen all-false object unless
 * `import.meta.env.DEV`, which folds to a constant in a build and takes every
 * branch downstream of it with it. The panel that sets them is behind the
 * same guard at its call site, the way ScreensSection is, so it never enters
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
   * A shape for the verdict, not only a colour.
   *
   * The nib is drawn hollow until the note is inside the window and solid
   * once it is. Green against amber is the single most confusable pair there
   * is, and the verdict currently rides on colour in four places at once --
   * the strobe already refuses colour entirely, so the precedent is the app's
   * own.
   */
  nibShape: boolean;
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
}

const OFF: Readonly<Experiments> = Object.freeze({
  holdFill: false,
  allTunedSweep: false,
  nibShape: false,
  easeVerdict: false,
  noteArrive: false,
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
  return import.meta.env.DEV ? live : OFF;
}

/** The same answer for code that is not a component. */
export function experiments(): Experiments {
  return import.meta.env.DEV ? experimentStore.get() : OFF;
}

/** Label and one line each, for the panel. Dev-only, and tree-shaken with it. */
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
    key: 'nibShape',
    name: 'Nib shape verdict',
    desc: 'Hollow until in tune, solid once it is, so the answer is not only a colour.',
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
];
