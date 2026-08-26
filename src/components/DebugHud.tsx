import { useRef } from 'react';
import { useTunerFrame } from '../hooks';
import { tuner } from '../tuner/TunerController';

/**
 * A readout of what the engine is actually hearing, for when the app looks
 * perfectly healthy and hears nothing.
 *
 * Off unless the URL carries `?debug`, so it costs the real app nothing. It
 * exists because a dead microphone and a quiet room are indistinguishable from
 * the outside: the tuner sits there showing its last note either way, and
 * there is no console to open on a phone.
 *
 * Written straight to the DOM rather than through state — it updates at frame
 * rate, and re-rendering React sixty times a second to print six numbers would
 * be measuring the instrument with the instrument.
 */
export function DebugHud() {
  const ref = useRef<HTMLDivElement>(null);
  const peak = useRef(0);

  useTunerFrame((frame) => {
    const el = ref.current;
    if (!el) return;
    const engine = tuner.engine;
    const level = engine.envelopeLevel;
    // Held so a pluck registers even if the frame you look at falls in a gap.
    peak.current = Math.max(peak.current * 0.97, level);
    const db = (v: number) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
    el.textContent = [
      `mic   ${engine.state}${engine.error ? ` (${engine.error.kind})` : ''}`,
      `in    ${db(level)} dB   peak ${db(peak.current)} dB`,
      `gate  ${db(engine.rmsGate)} dB   clarity ${engine.clarityThreshold.toFixed(2)}`,
      `hear  ${frame.hasSignal ? 'yes' : 'no'}   clarity ${frame.clarity.toFixed(2)}`,
      `hz    ${frame.frequency.toFixed(2)}   ${frame.cents >= 0 ? '+' : ''}${frame.cents.toFixed(1)}c`,
      `rate  ${engine.sampleRate || '-'}`,
      geometry(),
    ].join('\n');
  });

  return <div className="debug-hud" ref={ref} aria-hidden />;
}

/**
 * Where the app's box actually sits, which is not answerable from a screenshot.
 *
 * A strip of something showing under the app means one of these numbers
 * disagrees with the others, and which one it is decides the fix. `under` is
 * the whole question in a single figure: anything but zero and the app is not
 * filling the element it lives in.
 */
function geometry(): string {
  const app = document.getElementById('app');
  const root = document.getElementById('root');
  if (!app || !root) return '';
  const a = app.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  const css = getComputedStyle(document.documentElement);
  const px = (v: string) => Math.round(parseFloat(v) || 0);
  return [
    `vh    ${Math.round(window.innerHeight)}  root ${Math.round(r.height)}  app ${Math.round(a.height)}`,
    `under ${Math.round(r.bottom - a.bottom)}  past-root ${Math.round(window.innerHeight - r.bottom)}`,
    `inset t${px(css.getPropertyValue('--safe-t'))} b${px(css.getPropertyValue('--safe-b'))}`,
  ].join('\n');
}

/** True when the page was opened with `?debug`. */
export function debugRequested(): boolean {
  try {
    return new URLSearchParams(location.search).has('debug');
  } catch {
    return false;
  }
}
