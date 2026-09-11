/**
 * The pictures at the top of the purchase screen.
 *
 * Real screenshots off a real handset, shown at the shape they were taken --
 * a strip of phone-sized cards you scroll sideways, rather than one picture
 * cropped to fill a band. A tuner has one screen, and what money changes about
 * it is what it *looks* like, so eight photographs of the same screen wearing
 * eight different appearances is the honest advertisement.
 *
 * They are 600px wide here and 1170 on the phone. The widest a card is ever
 * drawn is about 180 CSS pixels, so 600 covers a 3x screen with room over;
 * the originals would have been a megabyte of detail nothing renders. Import
 * and resize with scratch/shots.py if the set is ever reshot.
 *
 * **A frame with no file is a placeholder, not a fault.** It draws a plain
 * panel with its own name on it, so a half-finished set reads as half
 * finished rather than as a broken image.
 *
 * Paths are relative to the app's base, which is not the site root on GitHub
 * Pages — see BASE_URL where they are used.
 */
export interface ShowcaseFrame {
  /** File under `public/showcase/`, or null while there is not one yet. */
  src: string | null;
  /** What the frame is of. Read aloud, and shown if there is no picture. */
  title: string;
}

/*
 * Ordered as an argument rather than as a contact sheet: the two styles first,
 * because the style is the biggest thing that changes; then the same screen
 * in a colour of its own; then the same screen with pieces taken off it.
 *
 * The last two are the same appearance twice, near enough — they came in as
 * one set and the difference between them is a trail. Delete either line if
 * the strip wants to be shorter; nothing else has to change.
 */
export const SHOWCASE: ShowcaseFrame[] = [
  { src: 'modern-dark.jpg', title: 'The Modern style, in dark' },
  { src: 'modern-light.jpg', title: 'The Modern style, in light' },
  { src: 'dark-green.jpg', title: 'A display color of your own' },
  { src: 'light-green.jpg', title: 'The same color, in light' },
  { src: 'light-pared.jpg', title: 'Pared back' },
  { src: 'dark-fewer-marks.jpg', title: 'Fewer marks on the screen' },
  { src: 'dark-bare.jpg', title: 'The tuner and nothing else' },
  { src: 'modern-dark-2.jpg', title: 'Modern, mid-note' },
];
