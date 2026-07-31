import { useEffect, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { listInputDevices } from '../audio/AudioEngine';
import { toneEngine } from '../audio/tone';
import {
  DEFAULT_HUE,
  DEFAULT_SETTINGS,
  sensitivityToDb,
  settingsStore,
  useSettings,
  type Settings,
  type ThemeMode,
  type ToleranceCents,
} from '../state/store';
import type { NoteNaming } from '../music/notes';
import { VISUALS, visualIndex } from './visuals/registry';

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
            options={[
              { value: 2 as ToleranceCents, label: '±2¢' },
              { value: 3 as ToleranceCents, label: '±3¢' },
              { value: 5 as ToleranceCents, label: '±5¢' },
              { value: 10 as ToleranceCents, label: '±10¢' },
            ]}
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
        >
          {/* Labelled with the actual noise floor it sets, in dBFS. */}
          <SliderField value={`${Math.round(sensitivityToDb(s.sensitivity))} dB`}>
            <input
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
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
        <Row name="Tone volume">
          <SliderField value={`${Math.round(s.toneVolume * 100)}%`}>
            <input
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.toneVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                set('toneVolume', v);
                toneEngine.volume = v;
              }}
              onPointerUp={() => {
                toneEngine.volume = settingsStore.get().toneVolume;
                toneEngine.play(440, 700);
              }}
              aria-label="Tone volume"
            />
          </SliderField>
        </Row>
        <Row name="Chime when in tune" desc="A short confirmation when a string lands.">
          <Switch
            on={s.chimeOnTuned}
            onChange={(v) => {
              set('chimeOnTuned', v);
              if (v) {
                toneEngine.volume = settingsStore.get().toneVolume;
                toneEngine.chime();
              }
            }}
            label="Chime when in tune"
          />
        </Row>
        <Row name="Vibration" desc="Buzz when a string reaches pitch. Android and most desktops.">
          <Switch on={s.haptics} onChange={(v) => set('haptics', v)} label="Vibration" />
        </Row>
      </Section>

      {/* ----------------------------------------------------------- colour */}
      <Section label="Colour">
        <Row name="Theme">
          <Segmented
            value={s.theme}
            options={[
              { value: 'dark' as ThemeMode, label: 'Dark' },
              { value: 'light' as ThemeMode, label: 'Light' },
              { value: 'system' as ThemeMode, label: 'Auto' },
            ]}
            onChange={(v) => set('theme', v)}
          />
        </Row>
        <Row name="App colour" desc="Tints the chassis, panels and text.">
          <HueField value={s.appHue} onChange={(v) => set('appHue', v)} label="App colour" />
        </Row>
        <Row name="Display colour" desc="Tints the tuner screen and its grid.">
          <HueField
            value={s.fieldHue}
            onChange={(v) => set('fieldHue', v)}
            label="Display colour"
          />
        </Row>
        {(s.appHue !== DEFAULT_HUE || s.fieldHue !== DEFAULT_HUE) && (
          <button
            className="btn btn--block"
            style={{ marginTop: 6 }}
            onClick={() => settingsStore.set({ appHue: DEFAULT_HUE, fieldHue: DEFAULT_HUE })}
          >
            Reset colours
          </button>
        )}
      </Section>

      {/* ---------------------------------------------------------- display */}
      <Section label="Display">
        <Row name="Tuner screen" desc={VISUALS[visualIndex(s.visual)].desc}>
          <Segmented
            value={s.visual}
            options={VISUALS.map((v) => ({ value: v.id, label: v.name }))}
            onChange={(v) => set('visual', v)}
          />
        </Row>
        <Row name="Show frequencies" desc="Detected and target pitch in hertz.">
          <Switch
            on={s.showFrequency}
            onChange={(v) => set('showFrequency', v)}
            label="Show frequencies"
          />
        </Row>
        <Row
          name="String caption"
          desc="The line under the string buttons — “Auto — play any string”, or which string is selected."
        >
          <Switch
            on={s.showStringHint}
            onChange={(v) => set('showStringHint', v)}
            label="String caption"
          />
        </Row>
        <Row name="Left-handed" desc="Mirrors the string row.">
          <Switch on={s.leftHanded} onChange={(v) => set('leftHanded', v)} label="Left-handed" />
        </Row>
        <Row name="Keep screen awake" desc="Stops the display sleeping mid-session.">
          <Switch on={s.keepAwake} onChange={(v) => set('keepAwake', v)} label="Keep screen awake" />
        </Row>
      </Section>

      <Section label="About">
        <button
          className="btn btn--block"
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
        </div>
      </Section>
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
}: {
  name: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting">
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
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="slider-field">
      <span className="hue-swatch" style={{ background: `hsl(${value} 45% 50%)` }} />
      <input
        className="slider slider--hue"
        type="range"
        min={0}
        max={359}
        step={1}
        value={value}
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
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      className="switch"
      data-on={on}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          data-on={o.value === value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
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
