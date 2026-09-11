/**
 * The App Store screenshot rig, behind `?screens` in dev only.
 *
 * Two jobs, and the second is the one that is easy to get subtly wrong.
 *
 * **Size.** Apple wants exact pixel counts, and a browser window is measured
 * in CSS pixels. The app is laid out at the CSS size the target implies and
 * then scaled so that what lands on the glass is the pixel count asked for --
 * `scale = targetDpr / devicePixelRatio`, which is the part that matters,
 * because a Windows desktop at 125% is not a 1:1 surface and a scale of 3
 * there produces 1552 pixels where 1242 were wanted. Scaling with a transform
 * rather than zoom keeps everything vector: the type is re-rasterised at the
 * final size rather than blown up.
 *
 * The one thing a transform cannot re-rasterise is a canvas, whose backing
 * store is fixed in pixels. `renderScale` below is read by the tuner screens
 * when they size themselves, so they allocate at the final resolution too --
 * see visuals/shared.
 *
 * **Capture.** A page cannot photograph itself, so this borrows the tab from
 * `getDisplayMedia` and crops the app out of the frame. Approve once and the
 * stream stays open; Shift+S then writes a PNG per press with nothing else on
 * screen. When the crop already matches the target the pixels are copied
 * across untouched, which is the whole point of getting the scale right.
 *
 * ## Using it
 *
 *   npm run dev, then open http://localhost:5440/?screens
 *
 * Pick a size under "Screenshots" at the bottom of Settings, press "Allow
 * capture" once and approve the tab, then close Settings and press Shift+S
 * for each shot. Files land in the browser's download folder.
 *
 * `?screens=off` puts it away. Like the other dev entry points, the choice is
 * stored and sticks -- see main.tsx.
 *
 * Compiled out of production: the flag reads `import.meta.env.DEV`, and the
 * section below is behind the same constant at its call site in SettingsSheet.
 */

import { useSyncExternalStore } from 'react';

export interface ScreenSize {
  id: string;
  label: string;
  /** What Apple asks for, in real pixels. */
  device: [number, number];
  /** The scale factor that pixel count is quoted at. */
  dpr: number;
}

/*
 * The two Apple currently requires. Every other size is derived from these by
 * App Store Connect, which is why there are two and not nine.
 */
export const SCREEN_SIZES: ScreenSize[] = [
  { id: 'phone', label: 'Phone', device: [1242, 2688], dpr: 3 },
  { id: 'ipad', label: 'iPad', device: [2064, 2752], dpr: 2 },
];

/** CSS pixels the app is laid out at, before the transform. */
export function cssSize(size: ScreenSize): [number, number] {
  return [size.device[0] / size.dpr, size.device[1] / size.dpr];
}

/* ------------------------------------------------------------------ state -- */

let current: ScreenSize | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/**
 * What a canvas should multiply its backing store by.
 *
 * 1 when nothing is framed, so the app behaves exactly as it always did. The
 * ratio, not the target: the device pixel ratio is already in the canvas's own
 * sum, and this supplies only what the transform adds on top.
 */
export function renderScale(): number {
  if (!current) return 1;
  return current.dpr / (window.devicePixelRatio || 1);
}

export function useScreenSize(): ScreenSize | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

export function setScreenSize(size: ScreenSize | null): void {
  if (current === size) return;
  current = size;
  apply();
  emit();
}

/**
 * Writes the frame onto the document, or takes it off again.
 *
 * Custom properties and one attribute rather than inline styles on the app,
 * because the rules that read them live in the stylesheet with everything
 * else that lays the app out — see `:root[data-screens]`.
 */
function apply(): void {
  const root = document.documentElement;
  if (!current) {
    delete root.dataset.screens;
    root.style.removeProperty('--screens-w');
    root.style.removeProperty('--screens-h');
    root.style.removeProperty('--screens-scale');
    delete (window as { __renderScale?: number }).__renderScale;
    window.dispatchEvent(new Event('resize'));
    return;
  }
  const [w, h] = cssSize(current);
  root.dataset.screens = current.id;
  root.style.setProperty('--screens-w', `${w}px`);
  root.style.setProperty('--screens-h', `${h}px`);
  root.style.setProperty('--screens-scale', String(renderScale()));
  // What the tuner canvases multiply their backing store by. A global rather
  // than an import, so nothing in the shipped app has to know this file
  // exists — see the note in visuals/shared.
  (window as { __renderScale?: number }).__renderScale = renderScale();
  // The canvases size themselves from a ResizeObserver, and their CSS box has
  // not changed — only what it is multiplied by. This is what tells them.
  window.dispatchEvent(new Event('resize'));
}

/* ---------------------------------------------------------------- capture -- */

let stream: MediaStream | null = null;
let shot = 0;

/** Whether a tab is already shared, so the button can say so. */
export function captureReady(): boolean {
  return stream !== null && stream.getVideoTracks()[0]?.readyState === 'live';
}

/**
 * Asks for the tab once, and keeps it.
 *
 * Must be called from a real gesture. The prompt is the browser's and cannot
 * be skipped, but it only has to be answered once per session — which is the
 * difference between a shortcut and a chore.
 */
export async function allowCapture(): Promise<boolean> {
  if (captureReady()) return true;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: false,
      // Chrome pre-selects this tab. Everywhere else it is ignored and the
      // picker opens as usual.
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      stream = null;
    });
    return true;
  } catch {
    stream = null;
    return false;
  }
}

/**
 * One frame, cropped to the app, saved as a PNG.
 *
 * The crop is the app's rectangle in device pixels, which is the coordinate
 * space the captured frame is already in — so when the sizing above has done
 * its job the crop is exactly the target and the copy is one-to-one. The
 * final canvas is the target size regardless, because a screenshot Apple
 * rejects for being a pixel short is worse than one that was resampled.
 */
export async function capture(): Promise<string> {
  if (!current) return 'Pick a size first.';
  if (!captureReady()) return 'Press "Allow capture" first.';

  const app = document.getElementById('app');
  if (!app || !stream) return 'Nothing to capture.';

  const track = stream.getVideoTracks()[0];
  const bitmap = await new ImageCapture(track).grabFrame();

  const dpr = window.devicePixelRatio || 1;
  const box = app.getBoundingClientRect();
  // The frame is the whole tab; the viewport tells us how its pixels map back
  // to ours. They agree on most machines and disagree on a scaled display.
  const ratio = bitmap.width / (window.innerWidth * dpr);
  const sx = Math.round(box.left * dpr * ratio);
  const sy = Math.round(box.top * dpr * ratio);
  const sw = Math.round(box.width * dpr * ratio);
  const sh = Math.round(box.height * dpr * ratio);

  const [tw, th] = current.device;
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'No canvas context.';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, tw, th);
  bitmap.close();

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return 'Could not encode the image.';

  shot += 1;
  const name = `eat-${current.id}-${String(shot).padStart(2, '0')}.png`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  const exact = sw === tw && sh === th;
  return `${name} — ${tw}x${th}${exact ? '' : ` (resampled from ${sw}x${sh})`}`;
}

/* --------------------------------------------------------------- shortcut -- */

let bound = false;

/** Shift+S, anywhere that is not a text field. */
export function installShortcut(onResult: (line: string) => void): void {
  if (bound) return;
  bound = true;
  window.addEventListener('keydown', (e) => {
    if (!current || !e.shiftKey || e.key.toLowerCase() !== 's') return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    e.preventDefault();
    void capture().then(onResult);
  });
}

/* ------------------------------------------------------------------- ui -- */

/**
 * Whether the rig was asked for, which is stored and therefore sticks.
 *
 * A function, not a const computed at load. As a const it was a top-level
 * side effect -- a localStorage read the bundler cannot prove is pure -- so
 * Rollup had to keep this module alive in the production build even after
 * tree-shaking everything in it that was actually used. The whole file drops
 * now, which was the point of putting the call site behind `import.meta.env`
 * in the first place.
 */
export function screensRequested(): boolean {
  try {
    return localStorage.getItem('easyastuning.screens') === '1';
  } catch {
    return false;
  }
}
