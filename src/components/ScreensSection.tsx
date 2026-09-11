/**
 * The screenshot rig's controls, at the bottom of Settings in dev only.
 *
 * Its own file rather than a block inside SettingsSheet, and that is the whole
 * reason it exists: the call site is `{import.meta.env.DEV && <ScreensSection
 * />}`, which in a production build is `false && …`, so the element is never
 * built, the import goes unreferenced, and the rig and its two Apple pixel
 * counts are dropped from the bundle. Written inline it would have shipped.
 *
 * What it does is in `src/screens.ts`. This is buttons.
 */

import { useEffect, useState } from 'react';
import {
  SCREEN_SIZES,
  allowCapture,
  capture,
  captureReady,
  cssSize,
  installShortcut,
  screensRequested,
  setScreenSize,
  useScreenSize,
  type ScreenSize,
} from '../screens';

export function ScreensSection() {
  const size = useScreenSize();
  const [ready, setReady] = useState(captureReady);
  /** The last thing that happened, so a press has an answer. */
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => installShortcut(setLine), []);

  if (!screensRequested()) return null;

  const pick = (next: ScreenSize | null) => setScreenSize(next);

  return (
    <div className="sheet__section">
      <div className="sheet__label">Screenshots</div>
      <div className="sheet__group">
        <div className="setting setting--stack">
          <div className="setting__main">
            <div className="setting__name">Frame</div>
            <div className="setting__desc">
              {size
                ? `${size.device[0]} x ${size.device[1]} — laid out at ${cssSize(size)[0]} x ${
                    cssSize(size)[1]
                  } and scaled to land on that`
                : 'The app, at the pixel counts App Store Connect asks for.'}
            </div>
          </div>
          <div className="segmented" role="group">
            <button data-on={size === null} onClick={() => pick(null)}>
              Off
            </button>
            {SCREEN_SIZES.map((s) => (
              <button key={s.id} data-on={size?.id === s.id} onClick={() => pick(s)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div className="setting__main">
            <div className="setting__name">{ready ? 'Capture armed' : 'Allow capture'}</div>
            <div className="setting__desc">
              {ready
                ? 'Close this panel and press Shift+S for each shot.'
                : 'Approve the tab once. The browser will not let a page do it silently.'}
            </div>
          </div>
          <button
            className="btn"
            onClick={() => void allowCapture().then((ok) => setReady(ok))}
            disabled={ready}
          >
            {ready ? 'Ready' : 'Allow'}
          </button>
        </div>

        <div className="setting">
          <div className="setting__main">
            <div className="setting__name">Take one now</div>
            <div className="setting__desc">
              {line ?? 'This panel will be in the picture. Shift+S is the useful one.'}
            </div>
          </div>
          <button className="btn" onClick={() => void capture().then(setLine)}>
            Capture
          </button>
        </div>
      </div>
    </div>
  );
}
