import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tuner } from './tuner/TunerController';
import { toneEngine } from './audio/tone';
import { haptic } from './haptics';
import { isNative } from './platform';
import { INSTRUMENTS } from './music/tunings';
import { sessionStore, settingsStore, useSettings } from './state/store';
import {
  useAppearance,
  useCurrentTuning,
  useSyncControllerSettings,
  useTunerEvent,
  useTunerFrame,
  useTunerVersion,
  useWakeLock,
} from './hooks';
import { TunerVisual } from './components/visuals';
import { NoteDisplay, Readout, TuningVerdict } from './components/Display';
import { Wordmark } from './components/Wordmark';
import { StringRow } from './components/StringRow';
import { TuningSheet } from './components/TuningSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { PowerGate } from './components/PowerGate';
import { DebugHud, debugRequested } from './components/DebugHud';
import { ChevronUpIcon, GearIcon, ResetIcon } from './components/Icons';
import type { EngineError } from './audio/AudioEngine';

export const APP_VERSION = __APP_VERSION__;

export default function App() {
  const settings = useSettings();
  const tuning = useCurrentTuning();

  const [micState, setMicState] = useState(tuner.micState);
  /*
   * True only while the packaged app's first automatic start is in flight,
   * so the gate does not flash up for the frame before it begins. False from
   * the outset in a browser, where nothing starts on its own.
   */
  const [autoStarting, setAutoStarting] = useState(isNative());
  const [micError, setMicError] = useState<EngineError | null>(null);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const appRef = useRef<HTMLDivElement>(null);
  const version = useTunerVersion();

  useAppearance(settings.theme, settings.hue);
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
      if (settingsStore.get().haptics) haptic('light');
      if (settingsStore.get().chimeOnTuned) {
        toneEngine.chime();
      }
    } else if (event.type === 'all-tuned') {
      // Acknowledged in the hand only — the string row already shows the state,
      // and a panel over the tuner is in the way of the next thing you play.
      if (settingsStore.get().haptics) haptic('medium');
    } else if (event.type === 'status') {
      setMicState(tuner.micState);
    }
  });

  /* -------------------------------------------------------------- mic --- */

  const startMic = useCallback(async () => {
    setMicError(null);
    setMicState('starting');
    // Same gesture unlocks the playback context on iOS.
    // Wired once, here, rather than at each place a tone is played: the
    // detector has to be told about every sound the app makes, and a call site
    // that forgets would leave the tuner reading its own reference note.
    toneEngine.onSound = (ms) => tuner.engine.deafenFor(ms);
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

  /*
   * The packaged app listens as soon as it opens. The browser still does not,
   * and the difference is not cosmetic.
   *
   * On the web the press is load-bearing: an AudioContext built outside a
   * user gesture comes up suspended on iOS Safari, and removing this once
   * before is what broke the tuner badly enough to be reverted. Inside the
   * app that policy is lifted — Capacitor sets
   * mediaTypesRequiringUserActionForPlayback to nothing — and the permission
   * dialog iOS raises on the first launch is itself the deliberate act the
   * gate was standing in for. Asking twice is asking twice.
   *
   * Nothing here assumes it worked. The gate is still rendered whenever the
   * tuner is not running, so a refusal, a failure, or a start that never
   * happens at all lands back on exactly the screen it always did.
   *
   * It also runs on the way back from the background, because the visibility
   * handler below drops the microphone when the app is hidden, and returning
   * to a tuner that has stopped listening is the same fault by another road.
   */
  useEffect(() => {
    if (!isNative()) return;
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      if (tuner.micState === 'running' || tuner.micState === 'starting') return;
      void startMic().then(() => setAutoStarting(false));
    };
    wake();
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
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

  const selectString = useCallback((index: number) => {
    tuner.selectString(index);
  }, []);

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
    <div
      className="app"
      id="app"
      ref={appRef}
      data-intune="false"
      /* A twelve-string wraps its key row onto two lines, and the tuner screen
         has to give back the height that costs — see .field-deck. */
      data-wide-row={targets.length > 8}
    >
      {debugRequested() && <DebugHud />}
      <header className="topbar">
        {/* Always rendered. Hiding it takes it out of sight but not out of the
            layout, so nothing below shifts when it is turned off. */}
        <Wordmark className={settings.showWordmark ? 'wordmark' : 'wordmark wordmark--off'} />

        <div className="topbar__row">
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <GearIcon />
          </button>

          {/* Standing configuration, kept out of the reading itself. */}
          <button
            className={settings.showStatus ? 'status' : 'status status--off'}
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
        </div>
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
          <TuningVerdict tolerance={settings.tolerance} />
          <TunerVisual
            visual={settings.visual}
            onChange={(visual) => settingsStore.set({ visual })}
            sampleRateLabel={sampleRateLabel}
            tolerance={settings.tolerance}
            // Hue is part of the key: the canvas caches its palette and must
            // re-read the custom properties when the screen is re-tinted.
            themeKey={`${settings.theme}:${settings.hue}`}
            naming={settings.naming}
            fallbackMidi={fallbackMidi}
          />
          <Readout show={settings.showFrequency} />
        </div>
      </main>

      <StringRow
        targets={targets}
        naming={settings.naming}
        selectedIndex={tuner.selectedIndex}
        tuned={tuner.tuned}
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

        {/*
          * Auto picks which *string* you are playing, and chromatic has none —
          * it reports whatever note it hears, from any instrument. The switch
          * has nothing to decide there, so it goes, and the tuning button
          * takes the width back rather than leaving a hole where it was.
          */}
        {!tuning.chromatic && (
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
        )}
      </footer>

      {/* The tuner stays on screen behind this, dimmed. On the web nothing
          starts without a real press; in the packaged app this is the fallback
          for a start that was refused or failed — see the effect above. */}
      {!running && !autoStarting && (
        <PowerGate
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
