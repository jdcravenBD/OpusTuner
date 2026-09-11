import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { listInputDevices } from '../audio/AudioEngine';
import { toneEngine } from '../audio/tone';
import { PurchaseScreen } from './PurchaseScreen';
import { CheckIcon, LockIcon } from './Icons';
import { restoreFullSet, type Outcome } from '../state/purchases';
import { TIER_NAME, isAppearanceLocked } from '../state/unlock';
import {
  DEFAULT_HUE,
  settingsStore,
  TOLERANCES,
  TRAIL_WIDTHS,
  useSettings,
  type Settings,
  type ThemeMode,
  type ThemeStyle,
} from '../state/store';
import type { NoteNaming } from '../music/notes';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when a change requires the capture graph to be rebuilt. */
  onRestartMic: () => void;
  micRunning: boolean;
  appVersion: string;
}

export function SettingsSheet({ open, onClose, onRestartMic, micRunning, appVersion }: Props) {
  const s = useSettings();
  /*
   * Modern is a fixed set of system colors rather than a tint of the app's,
   * so neither the mode nor the hue is its to follow. Both rows below say so
   * while it is the chosen style.
   */
  const modern = s.themeStyle === 'modern';
  /** Nothing for the hue slider to set: the palette has no color in it. */
  const colorless = modern || !s.themeColor;
  /** Names what the reader reached for, and opens the showcase. */
  const [wanted, setWanted] = useState<string | null>(null);
  /** 'idle' before anyone asks, 'busy' while Apple is being asked. */
  const [restoring, setRestoring] = useState<'idle' | 'busy' | Outcome>('idle');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listInputDevices().then((d) => {
      if (!cancelled) setDevices(d);
    });
    return () => {
      cancelled = true;
    };
  }, [open, micRunning]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    settingsStore.set({ [key]: value } as Partial<Settings>);

  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      {/* ------------------------------------------------------------ pitch */}
      <Section label="Pitch">
        <Row
          name="Reference pitch"
          desc="Concert A. Baroque ensembles often use 415, some orchestras 442 to 443."
        >
          <Stepper
            value={s.a4}
            min={415}
            max={466}
            step={1}
            format={(v) => `${v} Hz`}
            onChange={(v) => set('a4', v)}
          />
        </Row>
        {s.a4 !== 440 && (
          <button
            className="btn btn--block"
            style={{ marginTop: 6 }}
            onClick={() => set('a4', 440)}
          >
            Reset to A = 440 Hz
          </button>
        )}
        <Row name="Capo" desc="Raises every target so you can tune with a capo fitted.">
          <Stepper
            value={s.capo}
            min={0}
            max={12}
            step={1}
            format={(v) => (v === 0 ? 'None' : `Fret ${v}`)}
            onChange={(v) => set('capo', v)}
          />
        </Row>
        <Row name="In-tune window" desc="How close counts as tuned.">
          <Segmented
            value={s.tolerance}
            options={TOLERANCES.map((t) => ({ value: t, label: `±${t}¢` }))}
            onChange={(v) => set('tolerance', v)}
          />
        </Row>
        <Row name="Trail weight" desc="How heavy the Field screen draws the last few seconds.">
          <Segmented
            value={s.trailWidth}
            options={TRAIL_WIDTHS.map((w, i) => ({
              value: w,
              label: ['Fine', 'Normal', 'Bold'][i],
            }))}
            onChange={(v) => set('trailWidth', v)}
          />
        </Row>
        <Row name="Note names">
          <Segmented
            value={s.naming}
            options={[
              { value: 'sharp' as NoteNaming, label: '♯' },
              { value: 'flat' as NoteNaming, label: '♭' },
              { value: 'solfege' as NoteNaming, label: 'Do' },
            ]}
            onChange={(v) => set('naming', v)}
          />
        </Row>
      </Section>

      {/* -------------------------------------------------------- detection */}
      <Section label="Detection">
        <Row name="Auto string detect" desc="Pick the nearest string automatically as you play.">
          <Switch on={s.auto} onChange={(v) => set('auto', v)} label="Auto string detect" />
        </Row>
        <Row
          name="Advance automatically"
          desc="In manual mode, jump to the next untuned string once one lands."
        >
          <Switch
            on={s.autoAdvance}
            onChange={(v) => set('autoAdvance', v)}
            label="Advance automatically"
          />
        </Row>
        {/*
          There was a Sensitivity slider here, and no tuner anyone would
          compare this one to has one. The gate it set is measured from the
          room instead.
        */}
        <Row name="Microphone" desc={micRunning ? undefined : 'Start the tuner to see device names.'}>
          <select
            className="select"
            value={s.inputDeviceId}
            onChange={(e) => {
              set('inputDeviceId', e.target.value);
              onRestartMic();
            }}
            aria-label="Microphone"
          >
            <option value="default">System default</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Input ${i + 1}`}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      {/* ------------------------------------------------------------ sound */}
      <Section label="Sound & feedback">
        <Row name="Chime when in tune" desc="A short confirmation when a string lands.">
          <Switch
            on={s.chimeOnTuned}
            onChange={(v) => {
              set('chimeOnTuned', v);
              if (v) toneEngine.chime();
            }}
            label="Chime when in tune"
          />
        </Row>
        <Row name="Vibration" desc="Buzz when a string reaches pitch.">
          <Switch on={s.haptics} onChange={(v) => set('haptics', v)} label="Vibration" />
        </Row>
      </Section>

      {/* ---------------------------------------------------------- visual */}
      <Section label="Visual">
        <Row name="Style">
          <Segmented
            value={s.themeStyle}
            options={[
              { value: 'default' as ThemeStyle, label: 'Default' },
              {
                value: 'modern' as ThemeStyle,
                label: 'Modern',
                locked: isAppearanceLocked('themeStyle', 'modern', s.owned),
              },
            ]}
            onChange={(v) =>
              isAppearanceLocked('themeStyle', v, s.owned)
                ? setWanted('The Modern style')
                : set('themeStyle', v)
            }
          />
        </Row>
        {/*
          Modern is light and only light — see the theme's own note in the
          stylesheet. The row says so rather than accepting a press and
          changing nothing, which is the failure this whole section was
          rebuilt to stop: a control whose effect depends on a setting
          somewhere else.
        */}
        <Row name="Mode" desc={modern ? 'Modern is light only.' : undefined}>
          <Segmented
            value={s.themeMode}
            disabled={modern}
            options={[
              { value: 'dark' as ThemeMode, label: 'Dark' },
              {
                value: 'light' as ThemeMode,
                label: 'Light',
                locked: isAppearanceLocked('themeMode', 'light', s.owned),
              },
            ]}
            onChange={(v) =>
              isAppearanceLocked('themeMode', v, s.owned)
                ? setWanted('Light mode')
                : set('themeMode', v)
            }
          />
        </Row>
        {/*
          The switch turns the colour off altogether; the slider chooses which
          colour it is when it is on. One row because they are one decision,
          and the switch sits out on the right with every other switch in the
          panel rather than becoming a third kind of control.
        */}
        <Row
          name="Display color"
          desc={modern ? 'The Modern style brings its own colors.' : undefined}
          stack
          aside={
            <Switch
              on={s.themeColor && !modern}
              onChange={(v) =>
                isAppearanceLocked('themeColor', v, s.owned)
                  ? setWanted('Display color')
                  : set('themeColor', v)
              }
              label="Display color"
              locked={isAppearanceLocked('themeColor', true, s.owned)}
              disabled={modern}
            />
          }
        >
          <HueField
            value={s.hue}
            onChange={(v) => set('hue', v)}
            label="Display color"
            disabled={colorless}
          />
        </Row>
        {!colorless && s.hue !== DEFAULT_HUE && (
          <button
            className="btn btn--block"
            style={{ marginTop: 6 }}
            onClick={() => settingsStore.set({ hue: DEFAULT_HUE })}
          >
            Reset colors
          </button>
        )}
      </Section>

      {/* ---------------------------------------------------------- display */}
      <Section label="Display">
        <Row name="Title">
          <Switch
            on={s.showWordmark}
            onChange={(v) => (s.owned ? set('showWordmark', v) : setWanted('Hide the branding'))}
            label="Title"
            locked={!s.owned}
          />
        </Row>
        <Row name="Detail bar" desc="The reference pitch, window and capo strip.">
          <Switch
            on={s.showStatus}
            onChange={(v) => (s.owned ? set('showStatus', v) : setWanted('Hide the detail bar'))}
            label="Detail bar"
            locked={!s.owned}
          />
        </Row>
        <Row name="Note carousel" desc="The big note and its neighbours above the tuner.">
          <Switch
            on={s.showCarousel}
            onChange={(v) => (s.owned ? set('showCarousel', v) : setWanted('Hide the carousel'))}
            label="Note carousel"
            locked={!s.owned}
          />
        </Row>
        <Row name="Pitch indicator" desc={'The "Too sharp" and "Too flat" line.'}>
          <Switch
            on={s.showVerdict}
            onChange={(v) => (s.owned ? set('showVerdict', v) : setWanted('Hide the indicator'))}
            label="Pitch indicator"
            locked={!s.owned}
          />
        </Row>
        <Row
          name="Tuner marks"
          desc="Accidentals, corner print and the field's note names."
        >
          <Switch
            on={s.showTunerMarks}
            onChange={(v) => (s.owned ? set('showTunerMarks', v) : setWanted('Hide the tuner marks'))}
            label="Tuner marks"
            locked={!s.owned}
          />
        </Row>
        <Row name="Tuner arrows" desc="The two arrows either side of the tuner.">
          <Switch
            on={s.showTunerArrows}
            onChange={(v) =>
              s.owned ? set('showTunerArrows', v) : setWanted('Hide the tuner arrows')
            }
            label="Tuner arrows"
            locked={!s.owned}
          />
        </Row>
      </Section>

      {/* ------------------------------------------------------------- misc */}
      <Section label="Misc">
        <Row name="Left-handed" desc="Mirrors the string row.">
          <Switch on={s.leftHanded} onChange={(v) => set('leftHanded', v)} label="Left-handed" />
        </Row>
        <Row name="Keep screen awake" desc="Stops the display sleeping mid-session.">
          <Switch on={s.keepAwake} onChange={(v) => set('keepAwake', v)} label="Keep screen awake" />
        </Row>
      </Section>

      <Section label="About">
        {/*
          * Restore lives here as well as on the purchase screen, and it has to.
          *
          * The purchase screen only opens when a locked feature is pressed, so
          * the one person guaranteed never to reach it is the person who has
          * already paid and whose entitlement did not come back. Settings is
          * also simply where everyone looks for it.
          *
          * When it is owned the row stops being a button and becomes a receipt.
          * Offering to restore something you already have invites a press that
          * can only fail.
          */}
        {s.owned ? (
          <Row name={TIER_NAME} desc="Purchased. Every feature is unlocked on this device.">
            <CheckIcon size={16} />
          </Row>
        ) : (
          <Row name={`Restore ${TIER_NAME}`} desc={restoreHint(restoring)}>
            <button
              className="btn"
              disabled={restoring === 'busy'}
              onClick={() => {
                setRestoring('busy');
                void restoreFullSet().then(setRestoring);
              }}
            >
              {restoring === 'busy' ? 'Checking' + ELLIPSIS : 'Restore'}
            </button>
          </Row>
        )}
        <button
          className="btn btn--block sheet__reset"
          onClick={() => {
            if (confirm('Reset every setting to its default?')) settingsStore.reset();
          }}
        >
          Reset settings
        </button>
        {/*
          * Two lines, and both have to be here.
          *
          * The version and build are the first thing to ask for when someone
          * reports something, and this is the only place in the app they
          * appear. The font credit is a condition of the SIL Open Font
          * License, which requires attribution wherever the face ships.
          *
          * What was here and is not any more: a line about the McLeod Pitch
          * Method, and a line restating the default A and window. The first
          * was flattery of the algorithm, and the second repeated two numbers
          * the settings above already show, live, in the state they are
          * actually in.
          */}
        <div className="about">
          Easy as Tuning {appVersion} &middot; built {__BUILD_ID__}
          <br />
          Strobe readout set in 7-Segment by Jan Bobrowski, under the SIL Open Font
          License.
        </div>
      </Section>
      <PurchaseScreen open={wanted !== null} wanted={wanted} onClose={() => setWanted(null)} />
    </Sheet>
  );
}

/** Written as a character rather than typed, so the source stays ASCII. */
const ELLIPSIS = '\u2026';

/**
 * What the Restore row says underneath its name.
 *
 * Before anyone presses it, what the button is for. Afterwards, what came of
 * it. 'owned' never appears here because the row is replaced by the receipt
 * the moment the setting flips.
 */
function restoreHint(state: 'idle' | 'busy' | Outcome): string {
  switch (state) {
    case 'busy':
      return 'Asking the App Store.';
    case 'nothing-to-restore':
      return 'Nothing on this Apple ID to restore.';
    case 'pending':
      return 'Waiting on approval. It will unlock by itself once it comes.';
    case 'unavailable':
      return 'The App Store is not available here.';
    case 'failed':
      return 'That did not go through. Nothing has been charged.';
    default:
      return 'Already bought it on another device? Bring it back.';
  }
}

/* ------------------------------------------------------------- primitives -- */

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet__section">
      <div className="sheet__label">{label}</div>
      {/*
        The rows are wrapped because in a grouped list the group is a real
        object — a card the rows are lines in — and it needs an element to be.
        Deliberately its own class rather than `.stack`, which carries a flex
        gap that would land on top of the margin the rows already use and space
        every other theme differently. This one is styled by Modern and by
        nothing else.
      */}
      <div className="sheet__group">{children}</div>
    </div>
  );
}

function Row({
  name,
  desc,
  children,
  stack,
  aside,
}: {
  name: string;
  desc?: string;
  children: ReactNode;
  /**
   * Puts the control on its own line under the label rather than beside it.
   *
   * For a slider this is the difference between a hundred pixels of travel and
   * the whole width of the panel — the same range spread over three times the
   * distance, which is three times the precision under a thumb.
   */
  stack?: boolean;
  /**
   * A second control, kept up on the name's line while `children` stack below.
   *
   * For a row that is one decision made with two controls: a switch for
   * whether, out at the right with every other switch in the panel, and
   * something wider underneath for which.
   */
  aside?: ReactNode;
}) {
  const main = (
    <div className="setting__main">
      <div className="setting__name">{name}</div>
      {desc && <div className="setting__desc">{desc}</div>}
    </div>
  );
  return (
    <div className={stack ? 'setting setting--stack' : 'setting'}>
      {aside ? (
        <div className="setting__head">
          {main}
          {aside}
        </div>
      ) : (
        main
      )}
      {children}
    </div>
  );
}

/**
 * Hue picker: a slider running the full spectrum with a swatch of the chosen
 * hue beside it. The swatch is shown at mid lightness rather than at the near
 * -black the chassis actually uses, because a swatch of near-black tells you
 * nothing about which hue you have landed on.
 */
function HueField({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  /** The plain theme has no hue to set — the control says so rather than lying. */
  disabled?: boolean;
}) {
  return (
    <div className="slider-field slider-field--grow" data-disabled={disabled}>
      <span
        className="hue-swatch"
        style={{ background: disabled ? 'hsl(0 0% 50%)' : `hsl(${value} 45% 50%)` }}
      />
      <input
        className="slider slider--hue"
        type="range"
        min={0}
        max={359}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={`${value} degrees`}
      />
      <span className="slider-field__value">{value}°</span>
    </div>
  );
}

function Switch({
  on,
  onChange,
  label,
  locked,
  disabled,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
  /** Still pressable — the press is what opens the showcase. */
  locked?: boolean;
  /** Not pressable: there is nothing behind it to set. Unlike `locked`. */
  disabled?: boolean;
}) {
  return (
    <span className="switch-wrap">
      {locked && !disabled && <LockIcon size={13} />}
      <button
        className="switch"
        data-on={on}
        data-locked={locked}
        disabled={disabled}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
      />
    </span>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; locked?: boolean }[];
  onChange: (value: T) => void;
  /** Nothing here applies right now — see the Mode row. */
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /**
   * Where the lit pill sits, in pixels across the track.
   *
   * Measured rather than computed, because the options are not equal widths:
   * "Fine / Normal / Bold" and "±2¢ … ±20¢" each size to their own label, and
   * anything that assumed otherwise would slide the pill to the wrong place
   * the first time a label changed length.
   */
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  /*
   * Layout effect, not effect: this runs before the browser paints, so the
   * pill is already in position on the first frame. In a plain effect it
   * would be drawn at zero and then jump, and the jump would animate.
   */
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const on = root.querySelector<HTMLElement>('[data-on="true"]');
      if (!on) return setThumb(null);
      const next = { x: on.offsetLeft, w: on.offsetWidth };
      // Same numbers, same object. The measure runs from a ResizeObserver as
      // well as from a change of value, and handing back a fresh object every
      // time would re-render, re-measure and never stop.
      setThumb((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // The labels reflow when the panel does, and a rotation is the obvious
    // case: the pill has to end up back under the word it belongs to.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [value, options.length]);

  return (
    <div className="segmented" ref={ref} role="group" data-disabled={disabled}>
      {thumb && (
        <span
          className="segmented__thumb"
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
          aria-hidden
        />
      )}
      {options.map((o) => (
        <button
          key={String(o.value)}
          data-on={o.value === value}
          data-locked={o.locked && !disabled}
          disabled={disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.locked && !disabled && <LockIcon size={11} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="stepper">
      <button
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="stepper__value">{format(value)}</span>
      <button
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}
