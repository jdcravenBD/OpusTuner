/**
 * Switches for the five ideas being tried out, under the capture tools.
 *
 * Its own file for the same reason ScreensSection is: the call site reads
 * `{(import.meta.env.DEV || __PHONE_BUILD__) && <ExperimentsSection />}`, and
 * in a store build both of those are the constant false, so the element is
 * never constructed, the import goes unreferenced, and this file and its copy
 * leave the bundle. Written inline it would have shipped.
 *
 * The phone build is deliberately on that list. It is a production build, so
 * DEV alone kept these out of the only build you can hold while playing.
 *
 * The markup is written out rather than borrowing SettingsSheet's `Row` and
 * `Switch`, which are local to that file. Exporting them would close an import
 * cycle -- the sheet renders this -- for the sake of two wrappers. The classes
 * are the panel's own, so it looks like the rest of it either way.
 *
 * What the flags mean is in state/experiments.ts. This is switches.
 */

import { EXPERIMENTS, experimentStore, useExperiments } from '../state/experiments';

export function ExperimentsSection() {
  const on = useExperiments();
  const anyOn = EXPERIMENTS.some((e) => on[e.key]);

  return (
    <div className="sheet__section">
      <div className="sheet__label">Trying out</div>
      <div className="sheet__group">
        {EXPERIMENTS.map((e) => (
          <div className="setting" key={e.key}>
            <div className="setting__head">
              <div className="setting__main">
                <div className="setting__name">{e.name}</div>
                <div className="setting__desc">{e.desc}</div>
              </div>
              <span className="switch-wrap">
                <button
                  className="switch"
                  data-on={on[e.key]}
                  role="switch"
                  aria-checked={on[e.key]}
                  aria-label={e.name}
                  onClick={() => experimentStore.set({ [e.key]: !on[e.key] })}
                />
              </span>
            </div>
          </div>
        ))}
        <button
          className="btn btn--block"
          style={{ marginTop: 6 }}
          disabled={!anyOn}
          onClick={() => experimentStore.reset()}
        >
          All off
        </button>
      </div>
    </div>
  );
}
