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

export const GearIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

export const StarIcon = ({ size = 19, filled = false }: IconProps & { filled?: boolean }) => (
  <svg {...base(size)} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.8}>
    <path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.88l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z" />
  </svg>
);

export const ResetIcon = ({ size = 21 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36" />
    <path d="M3 4v5h5" />
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

/** App mark: a tuning fork. Matches the launcher icon in scripts/generate-icons.mjs. */
export const LogoMark = ({ size = 92 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden>
    <g
      stroke="currentColor"
      strokeWidth="10.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M31 12v30a17 17 0 0 0 34 0V12" />
      <path d="M48 59v16" />
    </g>
    <circle cx="48" cy="81" r="8.2" fill="currentColor" />
  </svg>
);
