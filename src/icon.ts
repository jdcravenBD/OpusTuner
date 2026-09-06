/**
 * The app icon, drawn as the tuning field itself, behind `?icon` in dev only.
 *
 * The icon is the Field screen filling the whole tile: same background, same
 * gridlines, same corridor, same green centre line, same nib. Not a screenshot
 * of it — a screenshot is the wrong shape (the screen is a tall 3:4 rectangle
 * and an icon is a square), the wrong size, and would carry the readout and
 * the note names, which an icon must not have. So it is re-composed square at
 * the exact output size, from the app's own colours and the app's own nib.
 *
 * ## Using it
 *
 *   npm run dev, then open http://localhost:5440/?icon
 *
 * Drag the sliders until it looks right, press Download, and the PNG lands in
 * your downloads folder at exactly 1024x1024. Then:
 *
 *   npm run icon:app -- ~/Downloads/easyastuning-icon-1024.png
 *
 * which flattens the alpha channel away and writes it into the iOS asset
 * catalog. That second step is not optional — see scripts/install-app-icon.mjs
 * for what Apple does to an icon that still has one.
 *
 * ## The corners
 *
 * iOS never shows an app icon square. It masks every one with a rounded
 * superellipse — a squircle, whose curvature eases continuously into the
 * straight edges rather than meeting them at a tangent the way an arc does.
 * The icon you submit is a plain square and the mask is applied on the device,
 * so the corners of this canvas are thrown away and must not carry anything.
 *
 * That is why the frame here is stroked along a superellipse and not a rounded
 * rectangle: a rounded rectangle drawn at the edge would visibly diverge from
 * the mask through the corners, running outside it at the diagonal and inside
 * it either side. `MASK_N` is the exponent, and the preview draws the mask so
 * you can see what will survive.
 *
 * Compiled out of production entirely: main.tsx only imports this module when
 * DEV is set, so the branch and the chunk both disappear from a real build.
 */

import { nibPath } from './components/visuals/PitchField';

/** Output size. The one Apple asks for, and every other size derives from it. */
const SIZE = 1024;

/**
 * Exponent of the superellipse iOS masks icons with.
 *
 * |x|^n + |y|^n = 1. At n = 2 that is a circle and at n = infinity a square;
 * the iOS icon shape sits at about 5, which is where the corner still reads as
 * generously round but the edges are already flat well before the midpoint.
 */
const MASK_N = 5;

/** Field edge, in cents. The same span the real screen shows. */
const RANGE_CENTS = 250;

interface Options {
  /** Where the nib sits, in cents. 0 hides it behind the centre line. */
  cents: number;
  /** Nib height as a fraction of the tile. */
  markerY: number;
  /** Nib size, relative to the app's own. */
  nibScale: number;
  /** Inset of the frame from the tile edge, in output pixels. */
  inset: number;
  /** Frame stroke weight, in output pixels. */
  border: number;
  /** Glow radius under the nib, in output pixels. */
  glow: number;
  /** Vertical cent gridlines. */
  grid: boolean;
  /** The falling horizontal rules. */
  rules: boolean;
  /** Weight of the green centre line, in output pixels. */
  line: number;
  /** Half-width of the translucent in-tune corridor, in cents. 0 is off. */
  corridor: number;
  /** Draw the iOS mask over the top, to show what gets cut. */
  showMask: boolean;
}

/*
 * Defaults chosen against the 60 px preview, not the big one.
 *
 * An icon is seen at about a sixtieth of this size, so everything in it is
 * divided by seventeen before anyone looks at it: the screen's own 1.5 px
 * centre line scales to 7 px here and vanishes, and the app's hairline frame
 * does the same. Both are deliberately heavier than the screen draws them,
 * which is the usual difference between a picture of an interface and an icon
 * of one.
 */
const DEFAULTS: Options = {
  cents: 62,
  markerY: 0.44,
  nibScale: 6.4,
  inset: 0,
  border: 15,
  glow: 58,
  line: 17,
  corridor: 24,
  grid: true,
  rules: true,
  showMask: false,
};

/* ------------------------------------------------------------- colours -- */

let probe: HTMLElement | null = null;

/**
 * Resolves a custom property to a real colour.
 *
 * The field's colours are `hsl()` built out of other custom properties, so
 * reading the property gives back the unresolved expression. Setting it as a
 * real `color` and reading that back makes the engine do the work — the same
 * trick visuals/shared.ts uses, and for the same reason.
 */
function css(name: string, fallback: string): string {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
    document.body.appendChild(probe);
  }
  probe.style.color = `var(${name}, ${fallback})`;
  return getComputedStyle(probe).color || fallback;
}

/* -------------------------------------------------------------- shapes -- */

/**
 * The superellipse iOS masks with, as a path.
 *
 * Walked parametrically rather than solved: at each angle the point is
 * (sign(cos t) * |cos t|^(2/n), sign(sin t) * |sin t|^(2/n)), which traces the
 * curve exactly. Enough steps that the polyline is under a pixel from the true
 * curve at this size.
 */
function squirclePath(ctx: CanvasRenderingContext2D, inset: number, newPath = true): void {
  const r = SIZE / 2 - inset;
  const c = SIZE / 2;
  const p = 2 / MASK_N;
  const STEPS = 720;

  // The mask preview needs this appended to a rectangle already in the path,
  // so that an even-odd fill leaves the corners and not the middle.
  if (newPath) ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const x = c + Math.sign(ct) * Math.pow(Math.abs(ct), p) * r;
    const y = c + Math.sign(st) * Math.pow(Math.abs(st), p) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** x of a cents offset, across the tile. */
function xOf(cents: number): number {
  return SIZE / 2 + (cents / RANGE_CENTS) * (SIZE / 2);
}

/* --------------------------------------------------------------- paint -- */

export function drawIcon(ctx: CanvasRenderingContext2D, o: Options): void {
  const green = css('--green', '#34e08a');
  const tick = css('--field-grid', 'rgba(255,255,255,0.17)');
  const top = css('--field-top', '#12151a');
  const mid = css('--field-bg', '#0b0d11');
  const bottom = css('--field-bottom', '#07080b');

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  /*
   * Full bleed, opaque, corner to corner.
   *
   * The corners are cut by the mask, but they must still be painted: an icon
   * with transparent corners is an icon Apple rejects, and one with *black*
   * corners under a mask that does not quite match shows a dark fringe. Same
   * gradient everywhere is the only answer that cannot go wrong.
   */
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE);
  bg.addColorStop(0, top);
  bg.addColorStop(0.55, mid);
  bg.addColorStop(1, bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // The screen's own highlight: light raking in from above the top edge.
  const sheen = ctx.createRadialGradient(
    SIZE / 2,
    -SIZE * 0.06,
    0,
    SIZE / 2,
    -SIZE * 0.06,
    SIZE * 0.9,
  );
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.62, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, SIZE, SIZE);

  /*
   * Everything from here is clipped to the mask shape.
   *
   * Not because the corners would otherwise show — they are cut anyway — but
   * because a gridline running to the very edge of the square gets sliced at
   * an angle by the mask and leaves a stub in the corner. Clipping to the same
   * curve the frame follows means every line ends where the frame is.
   */
  ctx.save();
  squirclePath(ctx, o.inset);
  ctx.clip();

  /* --- the falling rules ------------------------------------------------ */
  if (o.rules) {
    const spacing = SIZE * 0.105;
    ctx.strokeStyle = tick;
    ctx.lineWidth = SIZE * 0.0028;
    for (let y = spacing; y < SIZE; y += spacing) {
      // The real screen fades these toward the bottom; so does this.
      const depth = 1 - (y / SIZE) * 0.82;
      ctx.globalAlpha = 0.5 * depth;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SIZE, y);
      ctx.stroke();
    }
  }

  /* --- fixed cent gridlines --------------------------------------------- */
  if (o.grid) {
    for (let c = -RANGE_CENTS; c <= RANGE_CENTS; c += 50) {
      if (c === 0) continue;
      const major = c % 100 === 0;
      ctx.globalAlpha = major ? 0.95 : 0.45;
      ctx.strokeStyle = tick;
      ctx.lineWidth = SIZE * (major ? 0.0042 : 0.0028);
      ctx.beginPath();
      ctx.moveTo(xOf(c), 0);
      ctx.lineTo(xOf(c), SIZE);
      ctx.stroke();
    }
  }

  /* --- the in-tune corridor and the centre line -------------------------- */
  if (o.corridor > 0) {
    const half = xOf(o.corridor) - SIZE / 2;
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = green;
    ctx.fillRect(SIZE / 2 - half, 0, half * 2, SIZE);
  }

  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = green;
  ctx.lineWidth = o.line;
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 0);
  ctx.lineTo(SIZE / 2, SIZE);
  ctx.stroke();

  /* --- the nib ----------------------------------------------------------- */
  const x = xOf(o.cents);
  const y = SIZE * o.markerY;

  ctx.globalAlpha = 1;
  ctx.shadowColor = green;
  ctx.shadowBlur = o.glow;
  ctx.fillStyle = green;
  nibPath(ctx, x, y, o.nibScale);
  ctx.fill();
  // Twice, because one pass of a blur this wide is thin at the centre.
  ctx.fill();
  ctx.shadowBlur = 0;

  // The same bright core the screen puts inside the nib, so it stays legible
  // on top of its own glow.
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#ffffff';
  nibPath(ctx, x, y, o.nibScale * 0.44);
  ctx.fill();

  /* --- the recess ------------------------------------------------------- */
  /*
   * The screen is a hole in the chassis, not a card on top of it, and what
   * says so is shadow raking in from the top edge and wrapping the opening.
   * In CSS that is five inset boxShadows; here it is the same thing painted
   * as gradients along the inside of the frame.
   */
  ctx.globalAlpha = 1;
  const depth = SIZE * 0.13;

  const fromTop = ctx.createLinearGradient(0, o.inset, 0, o.inset + depth);
  fromTop.addColorStop(0, 'rgba(0,0,0,0.62)');
  fromTop.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fromTop;
  ctx.fillRect(0, 0, SIZE, o.inset + depth);

  const sides = ctx.createLinearGradient(o.inset, 0, o.inset + depth * 0.62, 0);
  sides.addColorStop(0, 'rgba(0,0,0,0.4)');
  sides.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sides;
  ctx.fillRect(0, 0, o.inset + depth * 0.62, SIZE);
  ctx.save();
  ctx.translate(SIZE, 0);
  ctx.scale(-1, 1);
  ctx.fillRect(0, 0, o.inset + depth * 0.62, SIZE);
  ctx.restore();

  const fromBottom = ctx.createLinearGradient(0, SIZE - o.inset - depth * 0.5, 0, SIZE - o.inset);
  fromBottom.addColorStop(0, 'rgba(0,0,0,0)');
  fromBottom.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = fromBottom;
  ctx.fillRect(0, SIZE - o.inset - depth * 0.5, SIZE, depth * 0.5 + o.inset);

  ctx.restore(); // release the clip

  /* --- the frame -------------------------------------------------------- */
  // The dark edge of the opening, on the mask's own curve so it stays parallel
  // to the icon's edge the whole way round instead of only along the flats.
  if (o.border > 0) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = o.border;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    squirclePath(ctx, o.inset + o.border / 2);
    ctx.stroke();

    // The lit hairline just inside it, which is what makes the edge read as
    // machined rather than drawn.
    ctx.lineWidth = Math.max(1, o.border * 0.32);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    squirclePath(ctx, o.inset + o.border * 1.35);
    ctx.stroke();
  }

  /* --- what iOS will cut ------------------------------------------------- */
  if (o.showMask) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,0,90,0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    squirclePath(ctx, 0, false);
    ctx.fill('evenodd');
  }

  ctx.restore();
}

/* ----------------------------------------------------------------- rig -- */

export function installIconRig(): void {
  const opts: Options = { ...DEFAULTS };

  /*
   * Pin the theme to the app's default rather than to whatever this browser
   * was last left on. The icon is one fixed artefact and has to be the same
   * every time it is generated; reading it off a stored setting would make the
   * output depend on which theme happened to be selected, which is how you end
   * up shipping a lilac icon. Plain is the default: dark, with the hue drained.
   */
  const root = document.documentElement;
  root.dataset.theme = 'dark';
  root.dataset.plain = 'true';
  delete root.dataset.basic;

  document.body.innerHTML = '';
  document.body.style.cssText =
    'margin:0;background:#15181d;color:#c9d2de;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;' +
    'display:flex;gap:24px;padding:24px;align-items:flex-start;flex-wrap:wrap';

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.cssText =
    'width:min(60vw,460px);height:auto;border-radius:0;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.6);image-rendering:auto';
  const ctx = canvas.getContext('2d')!;

  // A second copy at the size it is actually seen, because every icon problem
  // that matters is invisible at 460px and obvious at 60.
  const small = document.createElement('canvas');
  small.width = SIZE;
  small.height = SIZE;
  small.style.cssText = 'width:60px;height:60px;border-radius:13px';
  const sctx = small.getContext('2d')!;

  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px;min-width:290px';

  const render = () => {
    drawIcon(ctx, opts);
    sctx.clearRect(0, 0, SIZE, SIZE);
    sctx.drawImage(canvas, 0, 0);
  };

  const slider = (
    label: string,
    key: 'cents' | 'markerY' | 'nibScale' | 'inset' | 'border' | 'glow' | 'line' | 'corridor',
    min: number,
    max: number,
    step: number,
  ) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:4px';
    const name = document.createElement('span');
    const val = document.createElement('span');
    val.style.cssText = 'font-variant-numeric:tabular-nums;color:#8b95a3';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(opts[key]);
    input.style.gridColumn = '1 / -1';
    name.textContent = label;
    val.textContent = String(opts[key]);
    input.oninput = () => {
      opts[key] = Number(input.value);
      val.textContent = input.value;
      render();
    };
    row.append(name, val, input);
    panel.append(row);
  };

  const toggle = (label: string, key: 'grid' | 'rules' | 'showMask') => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;gap:8px;align-items:center';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = opts[key];
    input.onchange = () => {
      opts[key] = input.checked;
      render();
    };
    row.append(input, document.createTextNode(label));
    panel.append(row);
  };

  slider('Needle position (cents)', 'cents', -250, 250, 1);
  slider('Needle height', 'markerY', 0.1, 0.9, 0.01);
  slider('Needle size', 'nibScale', 3, 20, 0.1);
  slider('Frame inset (px)', 'inset', 0, 90, 1);
  slider('Frame weight (px)', 'border', 0, 30, 1);
  slider('Glow', 'glow', 0, 220, 1);
  slider('Centre line weight (px)', 'line', 0, 48, 1);
  slider('In-tune corridor (cents)', 'corridor', 0, 90, 1);
  toggle('Cent gridlines', 'grid');
  toggle('Horizontal rules', 'rules');
  toggle('Show what iOS cuts', 'showMask');

  const save = document.createElement('button');
  save.textContent = `Download ${SIZE}x${SIZE} PNG`;
  save.style.cssText =
    'margin-top:8px;padding:10px 14px;border-radius:8px;border:1px solid #34e08a;' +
    'background:#34e08a;color:#05210f;font-weight:600;cursor:pointer';
  save.onclick = () => {
    // The mask preview is a guide, never part of the output.
    const wasShowing = opts.showMask;
    opts.showMask = false;
    render();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `easyastuning-icon-${SIZE}.png`;
      a.click();
      URL.revokeObjectURL(url);
      opts.showMask = wasShowing;
      render();
    }, 'image/png');
  };

  const note = document.createElement('p');
  note.style.cssText = 'color:#8b95a3;max-width:290px;margin:4px 0 0';
  note.innerHTML =
    'Then flatten it into the app:<br>' +
    '<code style="color:#c9d2de">npm run icon:app -- &lt;path to the png&gt;</code><br><br>' +
    'The small square is the icon at the size a home screen actually shows it.';

  panel.append(save, note);

  const stack = document.createElement('div');
  stack.style.cssText = 'display:flex;flex-direction:column;gap:16px;align-items:center';
  stack.append(canvas, small);

  document.body.append(stack, panel);
  render();

  // eslint-disable-next-line no-console
  console.log('[icon] drag the sliders, then Download. Ctrl+S is not this.');
}
