/**
 * Common ground for the tuner screens.
 *
 * Each visual is a canvas driven straight from the tuner's frame stream, at
 * display rate, entirely outside React. They differ in what they draw and in
 * nothing else, so the parts that are the same — sizing the backing store,
 * reading the palette, measuring the frame interval — live here rather than
 * three times over.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { useTunerFrame } from '../../hooks';
import type { NoteNaming } from '../../music/notes';
import type { TunerFrame } from '../../tuner/TunerController';

/**
 * Canvas font stack. The symbol fonts are listed explicitly because the note
 * names carry real sharps (U+266F) and flats (U+266D), which plenty of UI
 * sans-serifs simply do not contain.
 */
export const visualFont = (px: number) =>
  `700 ${px}px system-ui, -apple-system, "Segoe UI Symbol", "Apple Symbols", ` +
  `"Noto Sans Symbols 2", "DejaVu Sans", sans-serif`;

export interface Palette {
  tick: string;
  tickHot: string;
  green: string;
  amber: string;
  text3: string;
}

export function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const get = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
  return {
    // Gridlines and labels have their own tokens so the screen can be tuned
    // independently of the surrounding chassis.
    tick: get('--field-grid', get('--tick', 'rgba(255,255,255,0.17)')),
    tickHot: get('--tick-hot', '#e9eef4'),
    green: get('--green', '#34e08a'),
    amber: get('--amber', '#ffb02e'),
    text3: get('--field-label', get('--text-3', '#5b6573')),
  };
}

/** Past this the reading turns amber — nearer some other note than the target. */
export const FAR_CENTS = 50;

/** Green when in tune, neutral when close, amber once another note is nearer. */
export function colourFor(p: Palette, cents: number, tolerance: number): string {
  const a = Math.abs(cents);
  if (a <= tolerance) return p.green;
  if (a > FAR_CENTS) return p.amber;
  return p.tickHot;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface Size {
  w: number;
  h: number;
  dpr: number;
}

/** Props every tuner screen is handed. */
export interface VisualProps {
  /** Half-width of the in-tune window, in cents. */
  tolerance: number;
  /** Changing this re-reads the CSS custom properties. */
  themeKey: string;
  naming: NoteNaming;
  /** Note to label against before anything has been detected. */
  fallbackMidi: number;
}

interface Options {
  themeKey: string;
  /** Called when the backing store is resized — drop any cached geometry. */
  onResize?: (size: Size) => void;
  /** @param dt seconds since the previous frame, clamped. */
  draw: (
    ctx: CanvasRenderingContext2D,
    size: Size,
    palette: Palette,
    frame: TunerFrame,
    dt: number,
  ) => void;
}

/**
 * Wires a canvas to the frame stream.
 *
 * The palette is re-read lazily at draw time rather than in an effect. A visual
 * is a child of the component that writes --h / --fh onto <html>, and child
 * effects run *before* parent effects — so reading on a themeKey effect would
 * sample the previous hue and leave the canvas a step behind every time the
 * screen colour changes.
 */
export function useVisualCanvas(opts: Options): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef<Size>({ w: 0, h: 0, dpr: 1 });
  const paletteRef = useRef<Palette | null>(null);
  const paletteKey = useRef<string | null>(null);
  const lastTime = useRef(0);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  /**
   * Matches the backing store to the CSS box. Called from a ResizeObserver and
   * again on every frame: the observer fires as part of the rendering
   * lifecycle, so it can be missed entirely if the element is laid out while
   * nothing is painting. Comparing clientWidth is cheap and makes the canvas
   * self-healing whenever that happens. Returns false while the box has no size
   * yet, which is the signal to skip the frame.
   */
  const syncSize = (canvas: HTMLCanvasElement): boolean => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const s = sizeRef.current;
    if (s.w === w && s.h === h && s.dpr === dpr) return true;
    const next = { w, h, dpr };
    sizeRef.current = next;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    optsRef.current.onResize?.(next);
    return true;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onResize = () => syncSize(canvas);
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    window.addEventListener('orientationchange', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTunerFrame((frame) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!syncSize(canvas)) return;

    const key = optsRef.current.themeKey;
    if (!paletteRef.current || paletteKey.current !== key) {
      paletteRef.current = readPalette();
      paletteKey.current = key;
    }

    const now = performance.now();
    if (lastTime.current === 0) lastTime.current = now;
    // Clamped so a backgrounded tab doesn't teleport anything on return.
    const dt = Math.min(0.1, Math.max(0, (now - lastTime.current) / 1000));
    lastTime.current = now;

    optsRef.current.draw(ctx, sizeRef.current, paletteRef.current, frame, dt);
  });

  return canvasRef;
}
