/**
 * The pictures at the top of the purchase screen.
 *
 * Static files rather than the app rendering itself in miniature, which is a
 * deliberate trade: a rendered preview can never be out of date, but it can
 * only ever show what the app looks like at a sixth of its size, and half the
 * things being sold here do not survive that. A picture can be composed.
 *
 * The cost of that choice is the one this screen has already paid once: a
 * strip of screenshots stood here before, went stale, and was taken out. The
 * guard against a repeat is that these live in one list with one job, so
 * "are these still true" is a question with somewhere to be asked.
 *
 * **A frame with no file is a placeholder, not a fault.** It draws a plain
 * panel with its own name on it, so a half-finished set reads as a set that
 * is half finished rather than as a broken image. Fill in `src` and the panel
 * is replaced by the picture; nothing else changes.
 *
 * Paths are relative to the app's base, which is not the site root on GitHub
 * Pages — see BASE_URL where they are used.
 */
export interface ShowcaseFrame {
  /** File under `public/showcase/`, or null while there is not one yet. */
  src: string | null;
  /** What the frame is of. Shown only while there is no picture. */
  title: string;
}

export const SHOWCASE: ShowcaseFrame[] = [
  { src: null, title: 'Every tuning' },
  { src: null, title: 'The chromatic tuner' },
  { src: null, title: 'The Modern style' },
  { src: null, title: 'Your own layout' },
];
