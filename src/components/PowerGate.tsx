import { useLayoutEffect, useState } from 'react';
import { PowerIcon } from './Icons';
import type { EngineError } from '../audio/AudioEngine';

interface Props {
  starting: boolean;
  error: EngineError | null;
  onStart: () => void;
}

/**
 * The off state.
 *
 * Not a separate screen. The tuner is already there, dimmed behind this, and
 * the only thing between you and it is a power button sitting in the middle of
 * the display — so starting reads as switching the instrument on rather than
 * as getting past a door.
 *
 * The press is load-bearing and must stay a press: iOS will not let an
 * AudioContext leave the suspended state outside a real user gesture, so this
 * cannot be replaced by starting automatically.
 */
export function PowerGate({ starting, error, onStart }: Props) {
  // Centred on the tuner screen rather than on the app. The button cannot live
  // inside .field — this layer has to cover the field too, so it must sit above
  // it — which leaves measuring where the field is.
  const [centre, setCentre] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const field = document.getElementById('field');
      const app = document.getElementById('app');
      if (!field || !app) return;
      const f = field.getBoundingClientRect();
      const a = app.getBoundingClientRect();
      if (!f.width) return;
      const next = { x: f.left + f.width / 2 - a.left, y: f.top + f.height / 2 - a.top };
      setCentre((prev) =>
        prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 ? prev : next,
      );
    };

    /*
     * Measured more than once on purpose. The field's width is a container
     * query against the app, and the first layout pass hands back a position it
     * then corrects — reading only in the layout effect puts the button some
     * way off the screen it is supposed to be sitting in the middle of.
     */
    measure();
    const raf = requestAnimationFrame(measure);
    const timer = setTimeout(measure, 0);

    const field = document.getElementById('field');
    const ro = field ? new ResizeObserver(measure) : null;
    ro?.observe(field!);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  const insecure = error?.kind === 'insecure-context';

  return (
    <div className="powergate" role="dialog" aria-label="Tuner is off">
      {/* A point at the centre of the screen. The button is centred on it and
          the caption hangs below, so however long the caption grows the button
          itself never moves off the middle of the display. */}
      <div
        className="powergate__inner"
        style={centre ? { left: centre.x, top: centre.y } : undefined}
      >
        <button
          className="powergate__btn"
          onClick={onStart}
          disabled={starting}
          aria-label={error ? 'Try again' : 'Turn the tuner on'}
        >
          <PowerIcon />
        </button>

        <div className="powergate__below">
          <div className="powergate__label">
            {starting ? 'Starting…' : error ? 'Tap to try again' : 'Tap to start listening'}
          </div>

          {error && (
            <div className="powergate__error">
              {error.message}
              {error.kind === 'permission-denied' && (
                <span className="powergate__hint">
                  Your browser remembers this per site. Allow the microphone from the
                  padlock in the address bar, then reload.
                </span>
              )}
              {insecure && (
                <span className="powergate__hint">
                  Microphones need <code>https://</code> or <code>localhost</code>.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
