/**
 * Note / pitch mathematics.
 *
 * Everything internally is a MIDI note number (A4 = 69). Display names are
 * derived at render time so the accidental style + reference pitch can change
 * without touching stored data.
 */

export type NoteNaming = 'sharp' | 'flat' | 'solfege';

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const SOLFEGE_NAMES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

/** Semitone offset from C for each letter. */
const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const A4_MIDI = 69;
export const DEFAULT_A4 = 440;

/** Frequency of a (possibly fractional) MIDI note for a given A4 reference. */
export function midiToFreq(midi: number, a4 = DEFAULT_A4): number {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Fractional MIDI note number for a frequency. */
export function freqToMidi(freq: number, a4 = DEFAULT_A4): number {
  return A4_MIDI + 12 * Math.log2(freq / a4);
}

/** Signed cents from `freq` to `targetFreq`. Positive = sharp. */
export function centsBetween(freq: number, targetFreq: number): number {
  return 1200 * Math.log2(freq / targetFreq);
}

/**
 * Parse scientific pitch notation ("E2", "A#3", "Bb1", "F♯1") to a MIDI number.
 * Throws on malformed input so bad tuning tables fail loudly at module load.
 */
export function parseNote(name: string): number {
  const m = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`Invalid note name: "${name}"`);
  const letter = m[1].toUpperCase();
  let semitone = LETTER_SEMITONES[letter];
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') semitone += 1;
    else semitone -= 1;
  }
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + semitone;
}

/** Pitch-class name (no octave) in the requested style. */
export function pitchClassName(midi: number, naming: NoteNaming = 'sharp'): string {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  if (naming === 'flat') return FLAT_NAMES[pc];
  if (naming === 'solfege') return SOLFEGE_NAMES[pc];
  return SHARP_NAMES[pc];
}

/** Octave number in scientific pitch notation (C4 = middle C). */
export function noteOctave(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

/** Full display name, e.g. "E2" / "E♭3". */
export function noteName(midi: number, naming: NoteNaming = 'sharp'): string {
  return pitchClassName(midi, naming) + noteOctave(midi);
}

/** True when the note's name carries an accidental in the given style. */
export function isAccidental(midi: number): boolean {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return [1, 3, 6, 8, 10].includes(pc);
}

/** Format a frequency the way tuners conventionally do. */
export function formatHz(freq: number): string {
  if (!isFinite(freq) || freq <= 0) return '—';
  if (freq >= 1000) return freq.toFixed(1);
  if (freq >= 100) return freq.toFixed(2);
  return freq.toFixed(2);
}
