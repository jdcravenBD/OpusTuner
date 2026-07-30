/**
 * The app wordmark.
 *
 * Set as "Easy ass Tuning" with the final "s" dropped to the faintest ink in
 * the palette, so it reads as "Easy as Tuning" at a glance and rewards a second
 * look. The dim letter is hidden from assistive tech, which means screen
 * readers and the accessible name both get the clean spelling.
 */
export function Wordmark({ className = 'wordmark' }: { className?: string }) {
  return (
    <span className={className}>
      Easy as
      <span className="wordmark__ghost" aria-hidden="true">
        s
      </span>{' '}
      Tuning
    </span>
  );
}
