import { noteOctave, pitchClassName, type NoteNaming } from '../music/notes';
import { CheckIcon } from './Icons';
import { useExperiments } from '../state/experiments';

interface Props {
  /** MIDI targets, lowest string first (capo already applied). */
  targets: number[];
  naming: NoteNaming;
  selectedIndex: number;
  tuned: boolean[];
  leftHanded: boolean;
  onSelect: (index: number) => void;
}

export function StringRow({
  targets,
  naming,
  selectedIndex,
  tuned,
  leftHanded,
  onSelect,
}: Props) {
  const { holdFill } = useExperiments();

  if (targets.length === 0) return <div className="strings" />;

  const count = targets.length;

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
              {/*
                The tuned countdown, as a band round the inside of the key.
                Dev experiment
                "Hold countdown"; `--hold` comes down from .app.

                A rounded rect rather than a circle, because the key is a
                squircle and a circle would cut its corners. `pathLength` is
                the whole trick: normalising the outline to 100 means the dash
                maths is the percentage itself, with no perimeter to work out
                from a radius that changes with the viewport.

                The numbers here and the stroke width in the stylesheet are
                one measurement in two places, and moving either alone breaks
                it. A stroke is centred on its path, so a band of width w
                sitting flush inside the edge wants its rect inset by w/2 and
                its corner radius reduced by the same -- 18 wide, inset 9,
                and 30 (the key's own 30% radius) less 9 is 21.

                Only on the key being tuned, and only while it is not already
                done -- `--hold` is one number on the app, so every key would
                otherwise draw the same ring at once.
              */}
              {holdFill && i === selectedIndex && !tuned[i] && (
                <svg className="string__hold" viewBox="0 0 100 100" aria-hidden>
                  <rect x="9" y="9" width="82" height="82" rx="21" ry="21" pathLength="100" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
