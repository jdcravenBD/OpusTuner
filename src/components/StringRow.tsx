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

  return (
    <div className={`strings${leftHanded ? ' strings--reverse' : ''}`}>
      <div className="strings__inner" role="group" aria-label="Strings">
        {targets.map((midi, i) => {
          // Conventional numbering: the highest-pitched string is #1.
          const stringNumber = count - i;
          const label = pitchClassName(midi, naming);
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
                {label}
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
