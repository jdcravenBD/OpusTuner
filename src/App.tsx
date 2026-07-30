import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tuner } from './tuner/TunerController';
import { haptic, toneEngine } from './audio/tone';
import { midiToFreq } from './music/notes';
import { INSTRUMENTS } from './music/tunings';
import { sessionStore, settingsStore, useSettings } from './state/store';
import {
  useCurrentTuning,
  useSyncControllerSettings,
  useTheme,
  useTunerEvent,
  useTunerFrame,
  useTunerVersion,
  useWakeLock,
} from './hooks';
import { PitchField } from './components/PitchField';
import { NoteDisplay, Readout } from './components/Display';
import { StringRow } from './components/StringRow';
import { TuningSheet } from './components/TuningSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { MicGate } from './components/MicGate';
import { ChevronUpIcon, GearIcon, ResetIcon } from './components/Icons';
import type { EngineError } from './audio/AudioEngine';

export const APP_VERSION = '1.0.0';

export default function App() {
  const settings = useSettings();
  const tuning = useCurrentTuning();

  const [micState, setMicState] = useState(tuner.micState);
  const [micError, setMicError] = useState<EngineError | null>(null);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const appRef = useRef<HTMLDivElement>(null);
  const version = useTunerVersion();

  useTheme(settings.theme);
  useWakeLock(settings.keepAwake && micState === 'running');
  useSyncControllerSettings();

  /* ---------------------------------------------------------- targets --- */

  const targets = useMemo(
    () => (tuning.chromatic ? [] : tuning.strings.map((m) => m + settings.capo)),
    [tuning, settings.capo],
  );

  useEffect(() => {
    tuner.setTargets(targets, !!tuning.chromatic);
  }, [targets, tuning.chromatic]);

  /* ------------------------------------------------------------- loop --- */

  useEffect(() => {
    tuner.startLoop();
    return () => tuner.stopLoop();
  }, []);

  // Paint the whole-screen green wash outside React — this flips several
  // times a second while the player closes in on pitch.
  useTunerFrame((frame) => {
    const value = String(frame.hasSignal && Math.abs(frame.cents) <= settings.tolerance);
    const el = appRef.current;
    if (el && el.dataset.intune !== value) el.dataset.intune = value;
  });

  useTunerEvent((event) => {
    if (event.type === 'tuned') {
      if (settingsStore.get().haptics) haptic([14, 40, 14]);
      if (settingsStore.get().chimeOnTuned) {
        toneEngine.volume = settingsStore.get().toneVolume;
        toneEngine.chime();
      }
    } else if (event.type === 'all-tuned') {
      setCelebrating(true);
      if (settingsStore.get().haptics) haptic([18, 55, 18, 55, 32]);
    } else if (event.type === 'status') {
      setMicState(tuner.micState);
    }
  });

  useEffect(() => {
    if (!celebrating) return;
    const id = setTimeout(() => setCelebrating(false), 2000);
    return () => clearTimeout(id);
  }, [celebrating]);

  /* -------------------------------------------------------------- mic --- */

  const startMic = useCallback(async () => {
    setMicError(null);
    setMicState('starting');
    // Same gesture unlocks the playback context on iOS.
    toneEngine.unlock();
    try {
      await tuner.startMic(settingsStore.get().inputDeviceId);
      setMicState('running');
      sessionStore.set({ onboarded: true });
    } catch (err) {
      setMicError(err as EngineError);
      setMicState('error');
    }
  }, []);

  const restartMic = useCallback(() => {
    if (tuner.micState !== 'running') return;
    tuner.stopMic();
    void startMic();
  }, [startMic]);

  // Release the microphone while backgrounded; browsers otherwise keep the
  // recording indicator lit and burn battery.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && tuner.micState === 'running') {
        tuner.stopMic();
        setMicState('idle');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => () => tuner.dispose(), []);

  /* ------------------------------------------------------------ render --- */

  const selectString = useCallback(
    (index: number) => {
      tuner.selectString(index);
      const midi = targets[index];
      if (settingsStore.get().referenceTones && midi != null) {
        toneEngine.volume = settingsStore.get().toneVolume;
        toneEngine.play(midiToFreq(midi, settingsStore.get().a4));
      }
    },
    [targets],
  );

  const instrumentName =
    INSTRUMENTS.find((i) => i.id === tuning.instrument)?.name ?? 'Tuning';
  const anyTuned = tuner.tuned.some(Boolean);
  const running = micState === 'running';

  // Gives the carousel and the field's gridline labels something meaningful to
  // show before the first note is detected.
  const fallbackMidi = targets[tuner.selectedIndex] ?? targets[0] ?? 0;

  const sampleRateLabel =
    running && tuner.engine.sampleRate
      ? `${(tuner.engine.sampleRate / 1000).toFixed(1)} kHz`
      : 'MPM';

  // `version` is read so React re-renders the string row when the controller
  // marks a string tuned or switches target.
  void version;

  return (
    <div className="app" ref={appRef} data-intune="false">
      <header className="topbar">
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >
          <GearIcon />
        </button>

        {/* Standing configuration, kept out of the reading itself. */}
        <button
          className="status"
          onClick={() => setSettingsOpen(true)}
          title="Reference pitch, in-tune window and capo — tap to change"
        >
          <span className="status__seg">
            <b>A</b>
            {settings.a4}
          </span>
          <span className="status__seg">±{settings.tolerance}¢</span>
          <span className="status__seg" data-on={settings.capo > 0}>
            {settings.capo > 0 ? `CAPO ${settings.capo}` : 'NO CAPO'}
          </span>
        </button>

        <button
          className="icon-btn"
          onClick={() => tuner.resetTuned()}
          disabled={!anyTuned}
          aria-label="Clear tuned strings"
          title="Clear tuned strings"
        >
          <ResetIcon />
        </button>
      </header>

      <main className="stage">
        <NoteDisplay
          naming={settings.naming}
          tolerance={settings.tolerance}
          fallbackMidi={fallbackMidi}
        />
        {/* The field is centred in this zone, which spans the full gap between
            the carousel and the string row. The frequency readout is pinned to
            the bottom of the zone so it cannot pull the field off centre. */}
        <div className="field-zone">
          <div className="field">
            <PitchField
              tolerance={settings.tolerance}
              themeKey={settings.theme}
              naming={settings.naming}
              fallbackMidi={fallbackMidi}
            />
            <span className="field__edge field__edge--flat" aria-hidden>
              ♭
            </span>
            <span className="field__edge field__edge--sharp" aria-hidden>
              ♯
            </span>
            {/* Instrument-face small print: scale and capture rate. */}
            <span className="field__note field__note--bl" aria-hidden>
              ±250 ¢
            </span>
            <span className="field__note field__note--br" aria-hidden>
              {sampleRateLabel}
            </span>
          </div>
          <Readout show={settings.showFrequency} />
        </div>
      </main>

      <StringRow
        targets={targets}
        naming={settings.naming}
        selectedIndex={tuner.selectedIndex}
        tuned={tuner.tuned}
        auto={settings.auto}
        leftHanded={settings.leftHanded}
        onSelect={selectString}
      />

      <footer className="bottombar">
        <button className="tuning-btn" onClick={() => setTuningOpen(true)}>
          <span className="tuning-btn__text">
            <span className="tuning-btn__instrument">
              {instrumentName}
              {settings.capo > 0 ? ` · capo ${settings.capo}` : ''}
            </span>
            <span className="tuning-btn__name">{tuning.name}</span>
          </span>
          <ChevronUpIcon />
        </button>

        <button
          className="toggle"
          data-on={settings.auto}
          onClick={() => settingsStore.set({ auto: !settings.auto })}
          aria-pressed={settings.auto}
        >
          Auto
          <span className="toggle__track">
            <span className="toggle__knob" />
          </span>
        </button>
      </footer>

      {celebrating && (
        <div className="celebrate" role="status">
          <div className="celebrate__title">All strings in tune</div>
          <div className="celebrate__sub">{tuning.name} · nicely done</div>
        </div>
      )}

      {!running && (
        <MicGate
          starting={micState === 'starting'}
          error={micError}
          onStart={() => void startMic()}
        />
      )}

      <TuningSheet
        open={tuningOpen}
        onClose={() => setTuningOpen(false)}
        naming={settings.naming}
      />
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onRestartMic={restartMic}
        micRunning={running}
        appVersion={APP_VERSION}
      />
    </div>
  );
}
