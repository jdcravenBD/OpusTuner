import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sheet, SHEET_EXIT_MS } from './Sheet';
import { CustomTuningEditor } from './CustomTuningEditor';
import { ClockIcon, CloseIcon, LockIcon, PlusIcon, SearchIcon, StarIcon } from './Icons';
import { PurchaseScreen } from './PurchaseScreen';
import { customTuningLimitReached, isTuningLocked } from '../state/unlock';
import { noteOctave, pitchClassName, type NoteNaming } from '../music/notes';
import { INSTRUMENTS, type InstrumentId, type Tuning } from '../music/tunings';
import {
  MAX_RECENT,
  markTuningUsed,
  selectTuning,
  sessionStore,
  toggleFavorite,
  useSession,
  useSettings,
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

/**
 * How long the chosen row is left lit before the sheet goes. Short enough not
 * to feel like a wait, long enough to register as an answer.
 */
const CONFIRM_MS = 190;

export function TuningSheet({ open, onClose, naming }: Props) {
  const session = useSession();
  const { owned } = useSettings();
  const all = useAllTunings();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Tuning | 'new' | null>(null);
  /** The row that has just been tapped, held green while the sheet leaves. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Names what the reader reached for, and opens the showcase. */
  const [wanted, setWanted] = useState<string | null>(null);
  const pickTimer = useRef<number | null>(null);
  const recentTimer = useRef<number | null>(null);
  /** Chosen, but not yet sorted into Recent — see `pick`. */
  const pendingRecent = useRef<string | null>(null);

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

  /*
   * A tuning is chosen the instant it is tapped, but the panel waits a beat
   * before leaving so the row can light up green underneath the finger. Closing
   * on the tap selected the tuning just as reliably and told you nothing: the
   * sheet simply vanished, and whether the press had landed on the row you
   * meant was anyone's guess.
   */
  const customLocked = customTuningLimitReached(owned, session.customTunings.length);

  /* Reaching the limit is not a dead end — the button says why. */
  const newCustom = () => {
    if (customLocked) setWanted('Unlimited custom tunings');
    else setEditing('new');
  };

  const pick = (t: Tuning) => {
    if (picked) return;
    if (isTuningLocked(t, owned)) {
      setWanted(t.name);
      return;
    }
    selectTuning(t.id);
    setPicked(t.id);
    // Recents are re-sorted only once the panel has gone — see the effect
    // below. Doing it on the tap moves the chosen row up into Recent while it
    // is still lit confirming the tap, so the row you just pressed jumps out
    // from under your finger.
    pendingRecent.current = t.id;
    pickTimer.current = window.setTimeout(close, CONFIRM_MS);
  };

  useEffect(() => {
    // Cleared on the way in rather than on the way out, so the row stays lit
    // for the whole of the slide instead of dropping a frame before it starts.
    if (open) {
      setPicked(null);
      return;
    }
    const id = pendingRecent.current;
    if (!id) return;
    pendingRecent.current = null;
    // Timed off the close itself rather than chained from the tap, so it
    // cannot drift in front of the panel it is waiting for.
    recentTimer.current = window.setTimeout(() => markTuningUsed(id), SHEET_EXIT_MS + 40);
  }, [open]);

  useEffect(
    () => () => {
      if (pickTimer.current !== null) clearTimeout(pickTimer.current);
      if (recentTimer.current !== null) clearTimeout(recentTimer.current);
    },
    [],
  );

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
      picked={picked === t.id}
      locked={isTuningLocked(t, owned)}
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
              onNew={newCustom}
              locked={customLocked}
            />
          </>
        ) : filter === 'custom' ? (
          <CustomSection
            tunings={session.customTunings}
            render={renderRow}
            onNew={newCustom}
            locked={customLocked}
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

      <PurchaseScreen open={wanted !== null} wanted={wanted} onClose={() => setWanted(null)} />
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
  locked,
}: {
  tunings: Tuning[];
  render: (t: Tuning) => ReactNode;
  onNew: () => void;
  /** At the free limit — the button still presses, and explains itself. */
  locked: boolean;
}) {
  return (
    <div className="sheet__section">
      <div className="sheet__label">My tunings</div>
      {tunings.length === 0 && (
        <div className="empty" style={{ padding: '10px 16px 14px' }}>
          Build any tuning you&rsquo;d like and save it here.
        </div>
      )}
      {tunings.map(render)}
      <button
        className="btn btn--block"
        onClick={onNew}
        style={{ marginTop: 8 }}
        data-locked={locked}
      >
        {locked ? <LockIcon /> : <PlusIcon />}
        New custom tuning
      </button>
    </div>
  );
}

function TuningRow({
  tuning,
  naming,
  selected,
  picked,
  locked,
  favorite,
  onPick,
  onToggleFavorite,
  onEdit,
}: {
  tuning: Tuning;
  naming: NoteNaming;
  selected: boolean;
  picked: boolean;
  locked: boolean;
  favorite: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
  onEdit?: () => void;
}) {
  const preview = tuning.chromatic
    ? 'Every note, any instrument'
    : tuning.strings.map((m) => pitchClassName(m, naming) + noteOctave(m)).join('  ');

  return (
    <div className="row" data-selected={selected} data-picked={picked} data-locked={locked}>
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
      {/* Favouriting something you cannot select is a control with nothing
          behind it, so the lock takes the slot rather than sitting beside it. */}
      {locked ? (
        <span className="row__lock" aria-label="Locked">
          <LockIcon />
        </span>
      ) : (
        <button
          className="row__star"
          data-on={favorite}
          onClick={onToggleFavorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={favorite}
        >
          <StarIcon filled={favorite} />
        </button>
      )}
    </div>
  );
}
