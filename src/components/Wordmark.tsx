/**
 * The app wordmark.
 *
 * Three parts, each doing a different job:
 *   "Easy"    heavy grotesque, full-strength ink
 *   "as"      set in the mono face at half size, the way every other technical
 *             annotation in this app is set — it reads as a connector, not a
 *             word, and lets the two real words carry the mark
 *   "Tuning"  same grotesque, in the signal green
 *
 * The final "s" of "ass" is dropped to the faintest ink in the palette, so the
 * mark reads as "Easy as Tuning" at a glance and rewards a second look.
 *
 * Exposed to assistive tech as a single labelled image, so screen readers get
 * the clean spelling rather than three fragments and a stray letter.
 */
export function Wordmark({ className = 'wordmark' }: { className?: string }) {
  return (
    <span className={className} role="img" aria-label="Easy as Tuning">
      <span className="wordmark__word" aria-hidden="true">
        Easy
      </span>
      <span className="wordmark__joint" aria-hidden="true">
        as<span className="wordmark__ghost">s</span>
      </span>
      <span className="wordmark__word wordmark__word--accent" aria-hidden="true">
        Tuning
      </span>
    </span>
  );
}
