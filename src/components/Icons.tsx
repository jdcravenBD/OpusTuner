/** Inline SVG icon set — no icon-font, no network request, themable via currentColor. */

interface IconProps {
  size?: number;
  className?: string;
}

/** Lighter strokes than the usual UI default — reads as drafted, not drawn. */
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/*
 * Apple's icon outline is a superellipse, not a rounded rectangle, and that is
 * the whole difference: a rounded rectangle changes curvature the instant the
 * arc starts, and the eye reads the join. This one never has a straight edge
 * to join to, so the corner arrives gradually and reads as one continuous
 * shape. |x|^n + |y|^n = 1 with n = 5 is the usual fit for the iOS mask.
 *
 * Sampled rather than approximated with four cubics, because the sampling is
 * exact and the cubic handles are somebody's guess. Ninety-six segments on a
 * 34px tile is a great deal finer than the pixels under it, and the whole
 * string is built once when the module loads.
 */
const SQUIRCLE = ((n = 5, r = 50, steps = 96) => {
  const p = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
  let d = '';
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = 50 + r * p(Math.cos(a), 2 / n);
    const y = 50 + r * p(Math.sin(a), 2 / n);
    d += `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return `${d}Z`;
})();

/**
 * The face on the promo row: an app icon for the app you are already in.
 *
 * The tile is nearly black rather than a mid grey, and the face is drawn
 * large enough to touch the corners of it. Both for the same reason: at the
 * size this is actually seen, a mid-grey square with a small face on it reads
 * as a grey square, and it is the face that has to carry from across a room.
 *
 * Every colour in here is a literal and not a token, which is deliberate --
 * it is a picture of a tile, and a tile does not re-tint with the panel it is
 * sitting on any more than a home screen icon re-tints with the wallpaper.
 * The orange is the dark palette's amber either way, because the light
 * palette's amber is a dark ink chosen to be read against white and this is
 * being read against near-black.
 *
 * The rim runs at half the alpha --stroke-mixed uses. That token is drawn on
 * faces a few levels off white, where a bright edge is an edge; here it is on
 * something nearly black, and at full strength it stopped reading as an edge
 * and started being the brightest thing in the row.
 *
 * The rim repeats --stroke-mixed from app.css by hand: a gradient cannot be a
 * border in CSS, which is why that one is a masked pseudo-element, but in SVG
 * it is simply what you stroke with. The viewBox is two units over on each
 * side so the stroke, which straddles the outline, is not half clipped.
 */
export const FaceIcon = ({ size = 44 }: IconProps) => (
  <svg width={size} height={size} viewBox="-2 -2 104 104" aria-hidden>
    <defs>
      <linearGradient id="eat-face-tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#18191c" />
        <stop offset="100%" stopColor="#090a0b" />
      </linearGradient>
      {/* 135deg, as a diagonal across the box. */}
      <linearGradient id="eat-face-rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
        <stop offset="34%" stopColor="#fff" stopOpacity="0.3" />
        <stop offset="66%" stopColor="#fff" stopOpacity="0.14" />
        <stop offset="100%" stopColor="#fff" stopOpacity="0.05" />
      </linearGradient>
    </defs>
    <path d={SQUIRCLE} fill="url(#eat-face-tile)" />
    {/*
      Two shadows rather than one: a tight bright halo for the filament and a
      wide faint one for the air around it. A single blur at either radius
      reads as a smudge.
    */}
    <g
      style={{
        filter: 'drop-shadow(0 0 2px rgba(255,176,46,0.95)) drop-shadow(0 0 7px rgba(255,176,46,0.55))',
      }}
    >
      <circle cx="32" cy="37" r="5.6" fill="#ffb02e" />
      <circle cx="68" cy="37" r="5.6" fill="#ffb02e" />
      <path
        d="M24 57 Q50 82 76 57"
        fill="none"
        stroke="#ffb02e"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </g>
    <path d={SQUIRCLE} fill="none" stroke="url(#eat-face-rim)" strokeWidth="2.2" />
  </svg>
);

export const GearIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const InfoIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M12 16.4v-5.2" />
    <path d="M12 7.9h.01" />
  </svg>
);

export const ChevronDownIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ChevronUpIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="m6 15 6-6 6 6" />
  </svg>
);

export const ChevronLeftIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const ChevronRightIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const CheckIcon = ({ size = 12 }: IconProps) => (
  <svg {...base(size)} strokeWidth={3.2}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const CloseIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const SearchIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
);

/**
 * A pushpin, drawn head-on rather than at the tilt the platform uses.
 *
 * Tilted reads better at 40 pixels and worse at 13, which is the size this is
 * actually used at: the diagonal puts the head and the point on different
 * pixel rows and both go soft. Square to the grid, the cap is one crisp line.
 */
export const PinIcon = ({ size = 19, filled = false }: IconProps & { filled?: boolean }) => (
  <svg {...base(size)} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.8}>
    <path d="M9.6 3.4h4.8v5.9l2.6 2.9H7l2.6-2.9z" />
    <path d="M12 12.2v8.4" />
  </svg>
);

export const ResetIcon = ({ size = 21 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36" />
    <path d="M3 4v5h5" />
  </svg>
);

/** The universal power glyph: a broken ring with the stroke through its gap. */
export const PowerIcon = ({ size = 30 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}>
    <path d="M12 3.5v8.2" />
    <path d="M6.6 6.9a7.6 7.6 0 1 0 10.8 0" />
  </svg>
);

export const PlusIcon = ({ size = 19 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TrashIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
);

export const SpeakerIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const ClockIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const ArrowUpIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.6}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const ArrowDownIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.6}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);

export const LockIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
  </svg>
);
