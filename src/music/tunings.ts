/**
 * Tuning presets.
 *
 * Strings are always listed lowest-pitched first, which is how they are shown
 * left-to-right in the string row (6th string -> 1st string for guitar).
 */

import { parseNote } from './notes';

export type InstrumentId =
  | 'guitar'
  | 'bass'
  | 'ukulele'
  | 'banjo'
  | 'orchestral'
  | 'other'
  | 'custom';

export interface Instrument {
  id: InstrumentId;
  name: string;
  /** Short label used in the compact instrument chip. */
  short: string;
}

export interface Tuning {
  id: string;
  name: string;
  instrument: InstrumentId;
  /** MIDI note numbers, lowest string first. */
  strings: number[];
  /** Marks the small set surfaced under "Popular". */
  popular?: boolean;
  /** Chromatic mode has no fixed string targets. */
  chromatic?: boolean;
  /** User-authored tunings are editable & deletable. */
  custom?: boolean;
  /** In the free set — see FREE_TUNING_IDS. */
  free?: boolean;
}

export const INSTRUMENTS: Instrument[] = [
  { id: 'guitar', name: 'Guitar', short: 'Guitar' },
  { id: 'bass', name: 'Bass', short: 'Bass' },
  { id: 'ukulele', name: 'Ukulele', short: 'Uke' },
  { id: 'banjo', name: 'Banjo', short: 'Banjo' },
  { id: 'orchestral', name: 'Orchestral', short: 'Strings' },
  { id: 'other', name: 'Other', short: 'Other' },
  { id: 'custom', name: 'My tunings', short: 'Custom' },
];

interface RawTuning {
  id: string;
  name: string;
  instrument: InstrumentId;
  notes: string;
  popular?: boolean;
}

const RAW: RawTuning[] = [
  // ---------------------------------------------------------------- guitar --
  { id: 'guitar-standard', name: 'Standard', instrument: 'guitar', notes: 'E2 A2 D3 G3 B3 E4', popular: true },
  { id: 'guitar-drop-d', name: 'Drop D', instrument: 'guitar', notes: 'D2 A2 D3 G3 B3 E4', popular: true },
  { id: 'guitar-half-step', name: 'Half Step Down', instrument: 'guitar', notes: 'D#2 G#2 C#3 F#3 A#3 D#4', popular: true },
  { id: 'guitar-whole-step', name: 'Whole Step Down', instrument: 'guitar', notes: 'D2 G2 C3 F3 A3 D4', popular: true },
  { id: 'guitar-drop-c#', name: 'Drop C♯', instrument: 'guitar', notes: 'C#2 G#2 C#3 F#3 A#3 D#4' },
  { id: 'guitar-drop-c', name: 'Drop C', instrument: 'guitar', notes: 'C2 G2 C3 F3 A3 D4', popular: true },
  { id: 'guitar-drop-b', name: 'Drop B', instrument: 'guitar', notes: 'B1 F#2 B2 E3 G#3 C#4' },
  { id: 'guitar-drop-a', name: 'Drop A', instrument: 'guitar', notes: 'A1 E2 A2 D3 F#3 B3' },
  { id: 'guitar-double-drop-d', name: 'Double Drop D', instrument: 'guitar', notes: 'D2 A2 D3 G3 B3 D4' },
  { id: 'guitar-dadgad', name: 'DADGAD', instrument: 'guitar', notes: 'D2 A2 D3 G3 A3 D4', popular: true },
  { id: 'guitar-open-d', name: 'Open D', instrument: 'guitar', notes: 'D2 A2 D3 F#3 A3 D4', popular: true },
  { id: 'guitar-open-dm', name: 'Open D Minor', instrument: 'guitar', notes: 'D2 A2 D3 F3 A3 D4' },
  { id: 'guitar-open-e', name: 'Open E', instrument: 'guitar', notes: 'E2 B2 E3 G#3 B3 E4' },
  { id: 'guitar-open-g', name: 'Open G', instrument: 'guitar', notes: 'D2 G2 D3 G3 B3 D4', popular: true },
  { id: 'guitar-open-gm', name: 'Open G Minor', instrument: 'guitar', notes: 'D2 G2 D3 G3 A#3 D4' },
  { id: 'guitar-open-a', name: 'Open A', instrument: 'guitar', notes: 'E2 A2 E3 A3 C#4 E4' },
  { id: 'guitar-open-c', name: 'Open C', instrument: 'guitar', notes: 'C2 G2 C3 G3 C4 E4' },
  { id: 'guitar-all-fourths', name: 'All Fourths', instrument: 'guitar', notes: 'E2 A2 D3 G3 C4 F4' },
  { id: 'guitar-nst', name: 'New Standard (NST)', instrument: 'guitar', notes: 'C2 G2 D3 A3 E4 G4' },
  { id: 'guitar-nashville', name: 'Nashville (High Strung)', instrument: 'guitar', notes: 'E3 A3 D4 G4 B3 E4' },
  { id: 'guitar-baritone', name: 'Baritone (B Standard)', instrument: 'guitar', notes: 'B1 E2 A2 D3 F#3 B3' },
  // A twelve-string is six courses, not twelve notes: the bottom four are
  // octave pairs and the top two are unisons, which is why E4 and B3 appear
  // twice over. Listed as twelve because that is how many you actually turn.
  { id: 'guitar-12-standard', name: '12-String Standard', instrument: 'guitar', notes: 'E2 E3 A2 A3 D3 D4 G3 G4 B3 B3 E4 E4', popular: true },
  { id: 'guitar-7-standard', name: '7-String Standard', instrument: 'guitar', notes: 'B1 E2 A2 D3 G3 B3 E4', popular: true },
  { id: 'guitar-7-drop-a', name: '7-String Drop A', instrument: 'guitar', notes: 'A1 E2 A2 D3 G3 B3 E4' },
  { id: 'guitar-8-standard', name: '8-String Standard', instrument: 'guitar', notes: 'F#1 B1 E2 A2 D3 G3 B3 E4' },
  { id: 'guitar-8-drop-e', name: '8-String Drop E', instrument: 'guitar', notes: 'E1 B1 E2 A2 D3 G3 B3 E4' },

  // ------------------------------------------------------------------ bass --
  { id: 'bass-standard', name: '4-String Standard', instrument: 'bass', notes: 'E1 A1 D2 G2', popular: true },
  { id: 'bass-drop-d', name: '4-String Drop D', instrument: 'bass', notes: 'D1 A1 D2 G2', popular: true },
  { id: 'bass-half-step', name: '4-String Half Step Down', instrument: 'bass', notes: 'D#1 G#1 C#2 F#2' },
  { id: 'bass-whole-step', name: '4-String Whole Step Down', instrument: 'bass', notes: 'D1 G1 C2 F2' },
  { id: 'bass-drop-c', name: '4-String Drop C', instrument: 'bass', notes: 'C1 G1 C2 F2' },
  { id: 'bass-5-standard', name: '5-String Standard', instrument: 'bass', notes: 'B0 E1 A1 D2 G2', popular: true },
  { id: 'bass-5-tenor', name: '5-String Tenor', instrument: 'bass', notes: 'E1 A1 D2 G2 C3' },
  { id: 'bass-6-standard', name: '6-String Standard', instrument: 'bass', notes: 'B0 E1 A1 D2 G2 C3' },

  // --------------------------------------------------------------- ukulele --
  { id: 'uke-standard', name: 'Standard C (High G)', instrument: 'ukulele', notes: 'G4 C4 E4 A4', popular: true },
  { id: 'uke-low-g', name: 'Low G', instrument: 'ukulele', notes: 'G3 C4 E4 A4', popular: true },
  { id: 'uke-baritone', name: 'Baritone', instrument: 'ukulele', notes: 'D3 G3 B3 E4', popular: true },
  { id: 'uke-d', name: 'D Tuning', instrument: 'ukulele', notes: 'A4 D4 F#4 B4' },
  { id: 'uke-slack-g', name: 'Open G (Slack Key)', instrument: 'ukulele', notes: 'G4 C4 E4 G4' },
  { id: 'uke-bass', name: 'Bass Ukulele', instrument: 'ukulele', notes: 'E1 A1 D2 G2' },

  // ----------------------------------------------------------------- banjo --
  { id: 'banjo-open-g', name: '5-String Open G', instrument: 'banjo', notes: 'G4 D3 G3 B3 D4', popular: true },
  { id: 'banjo-double-c', name: '5-String Double C', instrument: 'banjo', notes: 'G4 C3 G3 C4 D4' },
  { id: 'banjo-drop-c', name: '5-String Drop C', instrument: 'banjo', notes: 'G4 C3 G3 B3 D4' },
  { id: 'banjo-modal', name: '5-String G Modal (Sawmill)', instrument: 'banjo', notes: 'G4 D3 G3 C4 D4' },
  { id: 'banjo-open-d', name: '5-String Open D', instrument: 'banjo', notes: 'F#4 D3 F#3 A3 D4' },
  { id: 'banjo-tenor', name: 'Tenor Standard', instrument: 'banjo', notes: 'C3 G3 D4 A4', popular: true },
  { id: 'banjo-tenor-irish', name: 'Tenor Irish', instrument: 'banjo', notes: 'G2 D3 A3 E4' },
  { id: 'banjo-plectrum', name: 'Plectrum', instrument: 'banjo', notes: 'C3 G3 B3 D4' },

  // ------------------------------------------------------------ orchestral --
  { id: 'violin', name: 'Violin', instrument: 'orchestral', notes: 'G3 D4 A4 E5', popular: true },
  { id: 'viola', name: 'Viola', instrument: 'orchestral', notes: 'C3 G3 D4 A4', popular: true },
  { id: 'cello', name: 'Cello', instrument: 'orchestral', notes: 'C2 G2 D3 A3', popular: true },
  { id: 'double-bass', name: 'Double Bass', instrument: 'orchestral', notes: 'E1 A1 D2 G2' },
  { id: 'violin-5', name: '5-String Violin', instrument: 'orchestral', notes: 'C3 G3 D4 A4 E5' },
  { id: 'fiddle-cross', name: 'Fiddle Cross Tuning', instrument: 'orchestral', notes: 'A3 E4 A4 E5' },
  { id: 'harp-guitar', name: 'Viola da Gamba', instrument: 'orchestral', notes: 'D2 G2 C3 E3 A3 D4' },

  // ----------------------------------------------------------------- other --
  { id: 'mandolin', name: 'Mandolin', instrument: 'other', notes: 'G3 D4 A4 E5', popular: true },
  { id: 'mandola', name: 'Mandola', instrument: 'other', notes: 'C3 G3 D4 A4' },
  { id: 'mandocello', name: 'Mandocello', instrument: 'other', notes: 'C2 G2 D3 A3' },
  { id: 'bouzouki-irish', name: 'Irish Bouzouki', instrument: 'other', notes: 'G2 D3 A3 D4' },
  { id: 'bouzouki-greek', name: 'Greek Bouzouki', instrument: 'other', notes: 'C3 F3 A3 D4' },
  { id: 'cavaquinho', name: 'Cavaquinho', instrument: 'other', notes: 'D4 G4 B4 D5' },
  { id: 'balalaika', name: 'Balalaika (Prima)', instrument: 'other', notes: 'E4 E4 A4' },
  { id: 'charango', name: 'Charango', instrument: 'other', notes: 'G4 C5 E5 A4 E5' },
  { id: 'dobro-g', name: 'Dobro / Resonator (Open G)', instrument: 'other', notes: 'G2 B2 D3 G3 B3 D4' },
  { id: 'lap-steel-c6', name: 'Lap Steel C6', instrument: 'other', notes: 'C3 E3 G3 A3 C4 E4' },
  { id: 'oud-arabic', name: 'Oud (Arabic)', instrument: 'other', notes: 'C2 F2 A2 D3 G3 C4' },
  { id: 'sitar', name: 'Sitar (Main)', instrument: 'other', notes: 'C3 C2 G2 C3 G3 C4 F3' },
  { id: 'harp-celtic', name: 'Autoharp / Zither', instrument: 'other', notes: 'C3 G3 C4 E4 G4 C5' },
];

/**
 * The tunings that are free.
 *
 * One rule, and it is worth stating plainly because every borderline case
 * follows from it: **an instrument's own standard tuning is never paid.** A
 * seven-string guitar, a five-string bass, a baritone ukulele and a plectrum
 * banjo are instruments, not alternate tunings, and someone who owns one and
 * finds it locked has no use for the app at all. What is paid is the
 * alternates — the drops, the opens, the steps down, the modal and cross
 * tunings — which is where the value is for anyone already tuning happily.
 *
 * The calls worth knowing about, since a name alone does not settle them:
 *   - Baritone guitar and the 7- and 8-string are separate instruments, so
 *     their standards are free; 7-String Drop A and 8-String Drop E are not.
 *   - Open G on a resonator and C6 on a lap steel *are* those instruments'
 *     standard tunings, however they read.
 *   - 5-String Tenor bass is a five-string strung differently, not a different
 *     instrument, so it is paid.
 *   - Nashville is a way of stringing an ordinary guitar. Paid.
 */
export const FREE_TUNING_IDS: ReadonlySet<string> = new Set([
  'chromatic',
  // guitar, and the guitars that are their own instrument
  'guitar-standard',
  'guitar-baritone',
  'guitar-12-standard',
  'guitar-7-standard',
  'guitar-8-standard',
  // bass, by string count
  'bass-standard',
  'bass-5-standard',
  'bass-6-standard',
  // ukulele, by size
  'uke-standard',
  'uke-baritone',
  'uke-bass',
  // banjo, by type
  'banjo-open-g',
  'banjo-tenor',
  'banjo-plectrum',
  // the orchestral family — each of these is a different instrument
  'violin',
  'viola',
  'cello',
  'double-bass',
  'violin-5',
  'harp-guitar',
  // everything under "Other" is an instrument in its own right
  'mandolin',
  'mandola',
  'mandocello',
  'bouzouki-irish',
  'bouzouki-greek',
  'cavaquinho',
  'balalaika',
  'charango',
  'dobro-g',
  'lap-steel-c6',
  'oud-arabic',
  'sitar',
  'harp-celtic',
]);

export const CHROMATIC_TUNING: Tuning = {
  id: 'chromatic',
  name: 'Chromatic',
  instrument: 'other',
  strings: [],
  chromatic: true,
  popular: true,
  free: true,
};

export const BUILTIN_TUNINGS: Tuning[] = [
  CHROMATIC_TUNING,
  ...RAW.map(
    (r): Tuning => ({
      id: r.id,
      name: r.name,
      instrument: r.instrument,
      strings: r.notes.split(/\s+/).map(parseNote),
      popular: r.popular,
      free: FREE_TUNING_IDS.has(r.id),
    }),
  ),
];

const BY_ID = new Map(BUILTIN_TUNINGS.map((t) => [t.id, t]));

export function getBuiltinTuning(id: string): Tuning | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_TUNING_ID = 'guitar-standard';

/**
 * Compact preview string used in the tuning list rows, e.g. "E A D G B E".
 * Uses pitch-class names only — octaves would make the row too noisy.
 */
export function tuningPreview(t: Tuning, name: (midi: number) => string): string {
  if (t.chromatic) return 'All notes · any instrument';
  return t.strings.map(name).join(' ');
}
