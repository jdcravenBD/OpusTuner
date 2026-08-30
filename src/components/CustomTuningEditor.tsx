import { useState } from 'react';
import { Sheet } from './Sheet';
import { ArrowDownIcon, ArrowUpIcon, SpeakerIcon, TrashIcon } from './Icons';
import { midiToFreq, noteOctave, pitchClassName, type NoteNaming } from '../music/notes';
import { INSTRUMENTS, type InstrumentId, type Tuning } from '../music/tunings';
import { toneEngine } from '../audio/tone';
import { useSettings } from '../state/store';

const MIN_STRINGS = 2;
const MAX_STRINGS = 12;
/** C0 … C8 — comfortably brackets every real instrument. */
const MIN_MIDI = 12;
const MAX_MIDI = 108;

interface Props {
  open: boolean;
  naming: NoteNaming;
  /** Existing tuning to edit, or null to create a new one. */
  initial: Tuning | null;
  onSave: (tuning: Tuning) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function CustomTuningEditor({
  open,
  naming,
  initial,
  onSave,
  onCancel,
  onDelete,
}: Props) {
  const settings = useSettings();
  const [name, setName] = useState(initial?.name ?? '');
  const [instrument, setInstrument] = useState<InstrumentId>(initial?.instrument ?? 'guitar');
  const [strings, setStrings] = useState<number[]>(
    initial?.strings.slice() ?? [40, 45, 50, 55, 59, 64], // guitar standard
  );

  const setString = (index: number, delta: number) => {
    setStrings((prev) => {
      const next = prev.slice();
      next[index] = clamp(next[index] + delta, MIN_MIDI, MAX_MIDI);
      return next;
    });
  };

  const preview = (midi: number) => {
    toneEngine.play(midiToFreq(midi, settings.a4), 1400);
  };

  const save = () => {
    const trimmed = name.trim() || `Custom ${strings.map((m) => pitchClassName(m, naming)).join('')}`;
    onSave({
      id: initial?.id ?? `custom-${Date.now().toString(36)}`,
      name: trimmed,
      instrument,
      strings: strings.slice(),
      custom: true,
    });
  };

  return (
    <Sheet
      open={open}
      title={initial ? 'Edit tuning' : 'New tuning'}
      onClose={onCancel}
      right={
        <button className="icon-btn icon-btn--wide" onClick={save} aria-label="Save tuning">
          <span style={{ fontSize: 14, fontWeight: 750, color: 'var(--green)' }}>Save</span>
        </button>
      }
    >
      <div className="sheet__section">
        <div className="sheet__label">Name</div>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Drop C♯ baritone"
          maxLength={40}
        />
      </div>

      <div className="sheet__section">
        <div className="sheet__label">Category</div>
        <div className="chips" style={{ margin: 0, padding: '0 0 4px' }}>
          {INSTRUMENTS.filter((i) => i.id !== 'custom').map((i) => (
            <button
              key={i.id}
              className="chip"
              data-on={instrument === i.id}
              onClick={() => setInstrument(i.id)}
            >
              {i.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet__section">
        <div className="sheet__label">
          {strings.length} strings · lowest first
        </div>
        <div className="editor__strings">
          {strings.map((midi, i) => (
            <div className="editor__string" key={i}>
              <button
                className="editor__note"
                onClick={() => preview(midi)}
                aria-label={`Preview ${pitchClassName(midi, naming)}${noteOctave(midi)}`}
                title="Hear this note"
              >
                {pitchClassName(midi, naming)}
                <span style={{ fontSize: '0.65em', opacity: 0.6 }}>{noteOctave(midi)}</span>
              </button>
              <div className="editor__arrows">
                <button onClick={() => setString(i, -1)} aria-label="Lower by a semitone">
                  <ArrowDownIcon size={12} />
                </button>
                <button onClick={() => setString(i, 1)} aria-label="Raise by a semitone">
                  <ArrowUpIcon size={12} />
                </button>
              </div>
              <div className="editor__hz">{midiToFreq(midi, settings.a4).toFixed(1)} Hz</div>
            </div>
          ))}
        </div>

        <div className="row-gap" style={{ marginTop: 10 }}>
          <button
            className="btn"
            style={{ flex: 1 }}
            disabled={strings.length <= MIN_STRINGS}
            onClick={() => setStrings((s) => s.slice(0, -1))}
          >
            Remove string
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            disabled={strings.length >= MAX_STRINGS}
            onClick={() => setStrings((s) => [...s, clamp(s[s.length - 1] + 5, MIN_MIDI, MAX_MIDI)])}
          >
            Add string
          </button>
        </div>

        <button
          className="btn btn--block"
          style={{ marginTop: 8 }}
          onClick={() => {
                    strings.forEach((m, i) =>
              setTimeout(() => toneEngine.play(midiToFreq(m, settings.a4), 900), i * 420),
            );
          }}
        >
          <SpeakerIcon />
          Play all strings
        </button>
      </div>

      <div className="sheet__section">
        <button className="btn btn--primary btn--block" onClick={save}>
          {initial ? 'Save changes' : 'Create tuning'}
        </button>
        {onDelete && (
          <button className="btn btn--block btn--danger" style={{ marginTop: 8 }} onClick={onDelete}>
            <TrashIcon />
            {initial ? 'Delete tuning' : 'Cancel'}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
