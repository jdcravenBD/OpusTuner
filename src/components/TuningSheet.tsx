import { useMemo, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { CustomTuningEditor } from './CustomTuningEditor';
import { ClockIcon, CloseIcon, PlusIcon, SearchIcon, StarIcon } from './Icons';
import { noteOctave, pitchClassName, type NoteNaming } from '../music/notes';
import { INSTRUMENTS, type InstrumentId, type Tuning } from '../music/tunings';
import {
  MAX_RECENT,
  markTuningUsed,
  sessionStore,
  toggleFavorite,
  useSession,
} from '../state/store';
import { useAllTunings } from '../hooks';

interface Props {
  open: boolean;
  onClose: () => void;
  naming: NoteNaming;
}

type Filter = 'all' | InstrumentId;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...INSTRUMENTS.map((i) => ({ id: i.id as Filter, label: i.name })),
];

export function TuningSheet({ open, onClose, naming }: Props) {
  const session = useSession();
  const all = useAllTunings();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Tuning | 'new' | null>(null);

  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);
  const q = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!q) return null;
    return all.filter((t) => {
      const instrument = INSTRUMENTS.find((i) => i.id === t.instrument)?.name ?? '';
      const notes = t.strings.map((m) => pitchClassName(m, naming)).join(' ');
      return (
        t.name.toLowerCase().includes(q) ||
        instrument.toLowerCase().includes(q) ||
        notes.toLowerCase().includes(q)
      );
    });
  }, [q, all, naming]);

  const close = () => {
    setQuery('');
    onClose();
  };

  const pick = (t: Tuning) => {
    markTuningUsed(t.id);
    close();
  };

  // Chromatic is pinned to the top rather than buried under "Other" — it is
  // the mode people reach for when their instrument isn't in the list at all.
  const chromatic = all.find((t) => t.chromatic);

  const deleteCustom = (id: string) => {
    sessionStore.set((s) => ({
      customTunings: s.customTunings.filter((t) => t.id !== id),
      favoriteTuningIds: s.favoriteTuningIds.filter((f) => f !== id),
      recentTuningIds: s.recentTuningIds.filter((r) => r !== id),
      tuningId: s.tuningId === id ? 'guitar-standard' : s.tuningId,
    }));
  };

  const renderRow = (t: Tuning) => (
    <TuningRow
      key={t.id}
      tuning={t}
      naming={naming}
      selected={t.id === session.tuningId}
      favorite={session.favoriteTuningIds.includes(t.id)}
      onPick={() => pick(t)}
      onToggleFavorite={() => toggleFavorite(t.id)}
      onEdit={t.custom ? () => setEditing(t) : undefined}
    />
  );

  // Chromatic is already pinned above, so keep it out of the other groups
  // rather than listing the same row three times.
  // Sliced as well as capped on write, so a list stored by an older build
  // still renders at the current length.
  const recents = session.recentTuningIds
    .map((id) => byId.get(id))
    .filter((t): t is Tuning => !!t && !t.chromatic)
    .slice(0, MAX_RECENT);
  const favorites = session.favoriteTuningIds
    .map((id) => byId.get(id))
    .filter((t): t is Tuning => !!t && !t.chromatic);

  return (
    <>
      <Sheet open={open && !editing} title="Tunings" onClose={close} tall>
        <div className="search">
          <span className="search__icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            placeholder="Search tunings, instruments or notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button
              className="search__clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>

        <div className="chips">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className="chip"
              data-on={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {!searchResults && chromatic && (
          <div className="sheet__section">{renderRow(chromatic)}</div>
        )}

        {searchResults ? (
          searchResults.length ? (
            <Section
              label={`${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
            >
              {searchResults.map(renderRow)}
            </Section>
          ) : (
            <div className="empty">
              Nothing matched "{query}".
              <br />
              Try a tuning name like "DADGAD", an instrument, or a note like "Eb".
            </div>
          )
        ) : filter === 'all' ? (
          <>
            {recents.length > 0 && (
              <Section label="Recent" icon={<ClockIcon />}>
                {recents.map(renderRow)}
              </Section>
            )}
            {favorites.length > 0 && (
              <Section label="Favourites" icon={<StarIcon size={13} filled />}>
                {favorites.map(renderRow)}
              </Section>
            )}
            <Section label="Popular">
              {all.filter((t) => t.popular && !t.chromatic).map(renderRow)}
            </Section>
            {INSTRUMENTS.filter((i) => i.id !== 'custom').map((inst) => {
              const items = all.filter(
                (t) => t.instrument === inst.id && !t.custom && !t.chromatic,
              );
              if (!items.length) return null;
              return (
                <Section key={inst.id} label={inst.name}>
                  {items.map(renderRow)}
                </Section>
              );
            })}
            <CustomSection
              tunings={session.customTunings}
              render={renderRow}
              onNew={() => setEditing('new')}
            />
          </>
        ) : filter === 'custom' ? (
          <CustomSection
            tunings={session.customTunings}
            render={renderRow}
            onNew={() => setEditing('new')}
          />
        ) : (
          <Section label={INSTRUMENTS.find((i) => i.id === filter)?.name ?? ''}>
            {all.filter((t) => t.instrument === filter && !t.chromatic).map(renderRow)}
          </Section>
        )}
      </Sheet>

      {editing && (
        <CustomTuningEditor
          open
          naming={naming}
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          // A tuning being built has nothing stored yet, so deleting it is just
          // throwing the draft away — but the button belongs there either way,
          // so the way out is in the same place whichever you came in through.
          onDelete={() => {
            if (editing !== 'new') deleteCustom(editing.id);
            setEditing(null);
          }}
          onSave={(tuning) => {
            sessionStore.set((s) => {
              const exists = s.customTunings.some((t) => t.id === tuning.id);
              return {
                customTunings: exists
                  ? s.customTunings.map((t) => (t.id === tuning.id ? tuning : t))
                  : [...s.customTunings, tuning],
              };
            });
            markTuningUsed(tuning.id);
            setEditing(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------- fragments -- */

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sheet__section">
      <div className="sheet__label">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function CustomSection({
  tunings,
  render,
  onNew,
}: {
  tunings: Tuning[];
  render: (t: Tuning) => ReactNode;
  onNew: () => void;
}) {
  return (
    <div className="sheet__section">
      <div className="sheet__label">My tunings</div>
      {tunings.length === 0 && (
        <div className="empty" style={{ padding: '10px 16px 14px' }}>
          Build any tuning you like &mdash; set the note for each string and save it here.
        </div>
      )}
      {tunings.map(render)}
      <button className="btn btn--block" onClick={onNew} style={{ marginTop: 8 }}>
        <PlusIcon />
        New custom tuning
      </button>
    </div>
  );
}

function TuningRow({
  tuning,
  naming,
  selected,
  favorite,
  onPick,
  onToggleFavorite,
  onEdit,
}: {
  tuning: Tuning;
  naming: NoteNaming;
  selected: boolean;
  favorite: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
  onEdit?: () => void;
}) {
  const preview = tuning.chromatic
    ? 'Every note, any instrument'
    : tuning.strings.map((m) => pitchClassName(m, naming) + noteOctave(m)).join('  ');

  return (
    <div className="row" data-selected={selected}>
      <button
        className="row__main"
        onClick={onPick}
        style={{ background: 'none', textAlign: 'left' }}
      >
        <div className="row__name">{tuning.name}</div>
        <div className="row__meta">{preview}</div>
      </button>
      {onEdit && (
        <button className="row__badge" onClick={onEdit}>
          Edit
        </button>
      )}
      <button
        className="row__star"
        data-on={favorite}
        onClick={onToggleFavorite}
        aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}
        aria-pressed={favorite}
      >
        <StarIcon filled={favorite} />
      </button>
    </div>
  );
}
