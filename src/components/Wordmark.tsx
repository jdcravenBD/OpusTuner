/**
 * The app wordmark: EASYASSTUNING, tracked out across the full width.
 *
 * Set as individual letters in a space-between row rather than with
 * letter-spacing, because letter-spacing adds its gap *after* the final glyph
 * and would leave the mark visibly off-centre. This way the two end letters sit
 * flush with the edges and every gap between them is identical.
 *
 * One letter is dimmed: the second S of "ass". Everything else is one colour.
 *
 * Exposed as a single labelled image, so assistive tech gets the readable name
 * rather than thirteen separate letters.
 */
const LETTERS = 'EASYASSTUNING';

/** Index of the second S in "ass" — E-A-S-Y-A-S-[S]-T-U-N-I-N-G. */
const GHOST_INDEX = 6;

export function Wordmark({ className = 'wordmark' }: { className?: string }) {
  return (
    <span className={className} role="img" aria-label="Easy as Tuning">
      {LETTERS.split('').map((letter, i) => (
        <span
          key={i}
          className={i === GHOST_INDEX ? 'wordmark__ghost' : undefined}
          aria-hidden="true"
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
