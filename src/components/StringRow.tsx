import { noteOctave, pitchClassName, type NoteNaming } from '../music/notes';
import { CheckIcon } from './Icons';

interface Props {
  /** MIDI targets, lowest string first (capo already applied). */
  targets: number[];
  naming: NoteNaming;
  selectedIndex: number;
  tuned: boolean[];
  auto: boolean;
  leftHanded: boolean;
  onSelect: (index: number) => void;
}

export function StringRow({
  targets,
  naming,
  selectedIndex,
  tuned,
  auto,
  leftHanded,
  onSelect,
}: Props) {
  if (targets.length === 0) {
    return (
      <div className="strings">
        <div className="strings__hint">Chromatic — every note, any instrument</div>
      </div>
    );
  }

  const count = targets.length;
  const active = targets[selectedIndex];

  /*
   * Tunings often repeat a pitch class — standard guitar has E on both the 6th
   * and the 1st string. Labelling every repeat after the first in lower case
   * gives them distinct silhouettes, so "E … e" is scannable at a glance in a
   * way that "E … E" is not. Octave is ignored when matching, since E2 and E4
   * are exactly the pair that needs telling apart.
   *
   * First occurrence is by string order (lowest first), which is the leftmost
   * button in the normal layout and stays stable when the row is mirrored for
   * left-handed players.
   */
  const seenPitchClasses = new Set<number>();
  const isDuplicate = targets.map((midi) => {
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    const dup = seenPitchClasses.has(pc);
    seenPitchClasses.add(pc);
    return dup;
  });

  return (
    <div className={`strings${leftHanded ? ' strings--reverse' : ''}`}>
      <div className="strings__inner" role="group" aria-label="Strings">
        {targets.map((midi, i) => {
          // Conventional numbering: the highest-pitched string is #1.
          const stringNumber = count - i;
          const label = pitchClassName(midi, naming);
          const shown = isDuplicate[i] ? label.toLowerCase() : label;
          return (
            <button
              key={`${i}-${midi}`}
              className="string"
              data-active={i === selectedIndex}
              data-tuned={!!tuned[i]}
              onClick={() => onSelect(i)}
              aria-label={`String ${stringNumber}, ${label}${noteOctave(midi)}${
                tuned[i] ? ', in tune' : ''
              }`}
              aria-pressed={i === selectedIndex}
            >
              <span>
                {shown}
                <span className="string__octave">{noteOctave(midi)}</span>
              </span>
              {tuned[i] && (
                <span className="string__check">
                  <CheckIcon />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="strings__hint">
        {auto
          ? 'Auto — play any string'
          : `String ${count - selectedIndex} · ${pitchClassName(active, naming)}${noteOctave(active)} · tap to hear it`}
      </div>
    </div>
  );
}
