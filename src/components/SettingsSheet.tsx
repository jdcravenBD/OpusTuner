import { useEffect, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { listInputDevices } from '../audio/AudioEngine';
import { toneEngine } from '../audio/tone';
import { PurchaseScreen } from './PurchaseScreen';
import { LockIcon } from './Icons';
import { TIER_NAME, isThemeLocked } from '../state/unlock';
import {
  DEFAULT_HUE,
  DEFAULT_SETTINGS,
  sensitivityToDb,
  settingsStore,
  TOLERANCES,
  useSettings,
  type Settings,
  type ThemeMode,
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
  /* Both colorless themes leave the hue pickers with nothing to set. */
  const colorless = s.theme === 'plain' || s.theme === 'simple';
  /** Names what the reader reached for, and opens the showcase. */
  const [wanted, setWanted] = useState<string | null>(null);
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
          desc="Concert A. Baroque ensembles often use 415, some orchestras 442–443."
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
        <Row
          name="Sensitivity"
          desc="Lower for noisy rooms and quiet instruments, higher to reject stray sound."
          stack
        >
          {/* Labelled with the actual noise floor it sets, in dBFS. */}
          <SliderField value={`${Math.round(sensitivityToDb(s.sensitivity))} dB`}>
            <input
              className="slider"
              type="range"
              min={0}
              max={1}
              /* Twenty positions felt like a ratchet across the full width.
                 A hundred is smooth under a thumb and still lands on a stable
                 number in the readout. */
              step={0.01}
              value={s.sensitivity}
              onChange={(e) => set('sensitivity', Number(e.target.value))}
              aria-label="Sensitivity"
              aria-valuetext={`${Math.round(sensitivityToDb(s.sensitivity))} decibels`}
            />
          </SliderField>
        </Row>
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
        <Row name="Reference tones" desc="Tap a string to hear the note you're aiming for.">
          <Switch
            on={s.referenceTones}
            onChange={(v) => set('referenceTones', v)}
            label="Reference tones"
          />
        </Row>
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

      {/* ----------------------------------------------------------- color */}
      <Section label="Color">
        <Row name="Theme">
          <Segmented
            value={s.theme}
            options={[
              { value: 'simple' as ThemeMode, label: 'Simple' },
              { value: 'plain' as ThemeMode, label: 'Plain' },
              { value: 'dark' as ThemeMode, label: 'Dark', locked: isThemeLocked('dark', s.owned) },
              {
                value: 'light' as ThemeMode,
                label: 'Light',
                locked: isThemeLocked('light', s.owned),
              },
            ]}
            onChange={(v) => (isThemeLocked(v, s.owned) ? setWanted('Color themes') : set('theme', v))}
          />
        </Row>
        <Row name="Display color">
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
        <Row name="Detail bar">
          <Switch on={s.showStatus} onChange={(v) => set('showStatus', v)} label="Detail bar" />
        </Row>
        <Row name="Frequency bar">
          <Switch
            on={s.showFrequency}
            onChange={(v) => set('showFrequency', v)}
            label="Frequency bar"
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
          * Temporary, and on by default. There is no store to buy the full set
          * from yet, so without this the app's author would be locked out of
          * their own app. Both this row and the flag behind it come out before
          * this ships anywhere with a price on it.
          */}
        <Row name={`${TIER_NAME} (developer)`} desc="Unlocks everything. Goes before release.">
          <Switch on={s.owned} onChange={(v) => set('owned', v)} label={`${TIER_NAME}`} />
        </Row>
        <button
          className="btn btn--block"
          style={{ marginTop: 14 }}
          onClick={() => {
            if (confirm('Reset every setting to its default?')) settingsStore.reset();
          }}
        >
          Reset settings
        </button>
        <div className="about">
          Easy as Tuning {appVersion}
          <br />
          Pitch detection by the McLeod Pitch Method — accurate to well under a cent
          on a clean signal.
          <br />
          Defaults: A = {DEFAULT_SETTINGS.a4} Hz, ±{DEFAULT_SETTINGS.tolerance}¢ window.
          <br />
          Strobe readout set in 7-Segment by Jan Bobrowski, under the SIL Open Font
          License.
        </div>
      </Section>
      <PurchaseScreen open={wanted !== null} wanted={wanted} onClose={() => setWanted(null)} />
    </Sheet>
  );
}

/* ------------------------------------------------------------- primitives -- */

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet__section">
      <div className="sheet__label">{label}</div>
      {children}
    </div>
  );
}

function Row({
  name,
  desc,
  children,
  stack,
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
}) {
  return (
    <div className={stack ? 'setting setting--stack' : 'setting'}>
      <div className="setting__main">
        <div className="setting__name">{name}</div>
        {desc && <div className="setting__desc">{desc}</div>}
      </div>
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

/** A slider with its current value pinned alongside, in monospace. */
function SliderField({ value, children }: { value: string; children: ReactNode }) {
  return (
    <div className="slider-field">
      {children}
      <span className="slider-field__value">{value}</span>
    </div>
  );
}

function Switch({
  on,
  onChange,
  label,
  locked,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
  /** Still pressable — the press is what opens the showcase. */
  locked?: boolean;
}) {
  return (
    <span className="switch-wrap">
      {locked && <LockIcon size={13} />}
      <button
        className="switch"
        data-on={on}
        data-locked={locked}
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
}: {
  value: T;
  options: { value: T; label: string; locked?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          data-on={o.value === value}
          data-locked={o.locked}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.locked && <LockIcon size={11} />}
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
