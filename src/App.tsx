import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tuner } from './tuner/TunerController';
import { toneEngine } from './audio/tone';
import { haptic } from './haptics';
import { isNative } from './platform';
import { reconcileEntitlement } from './state/purchases';
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
import { NoteDisplay, TuningVerdict } from './components/Display';
import { Wordmark } from './components/Wordmark';
import { StringRow } from './components/StringRow';
import { TuningSheet } from './components/TuningSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { PowerGate } from './components/PowerGate';
import { DebugHud, debugRequested } from './components/DebugHud';
import { ChevronUpIcon, GearIcon, ResetIcon } from './components/Icons';
import type { EngineError } from './audio/AudioEngine';

export const APP_VERSION = __APP_VERSION__;

/**
 * How long the app must have been visible before the microphone watchdog will
 * act, and how many times it will act before leaving well alone.
 *
 * Two seconds because nothing arrives while backgrounded, so the first check
 * after a resume would otherwise read a stale clock and rebuild a graph that
 * was about to be fine. Two attempts because the failure it exists for -- the
 * audio session taken across an app switch -- is fixed by the first one; a
 * third would only be the second one again.
 */
const GRACE_MS = 2000;
const MAX_REMEDIES = 2;

export default function App() {
  const settings = useSettings();
  const tuning = useCurrentTuning();

  const [micState, setMicState] = useState(tuner.micState);
  /*
   * True while an automatic start is in flight, so the gate does not flash
   * up in the frames before it begins. False from the outset in a browser,
   * where nothing starts on its own.
   *
   * This used to be set false after the *first* start and never set again,
   * which is fine on launch and wrong on every return from the background:
   * the app drops the microphone when it is hidden, so coming back runs a
   * fresh start with the flag already down, and the gate rendered for the
   * frames in between.
   */
  const [autoStarting, setAutoStarting] = useState(isNative());
  const [micError, setMicError] = useState<EngineError | null>(null);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const appRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const version = useTunerVersion();

  /*
   * How much of the app the Full screen has to share, top and bottom.
   *
   * Two numbers in CSS pixels: from the app's top edge to where the tuner's
   * own row begins, and from the end of that row to the app's bottom. In every
   * other size they are zero and nothing reads them.
   *
   * Measured, not derived. The chassis above the tuner is four independent
   * toggles and a wrapping key row below it, so the only honest source for
   * "where does the furniture end" is where the layout actually put it -- and
   * .field-zone is exactly the space the column had left over. They feed two
   * things: the veil in app.css, through custom properties, and the screens
   * themselves, which lay their readings out inside what is left so a nib or a
   * strobe readout never ends up behind a string button.
   */
  const [fullInset, setFullInset] = useState({ top: 0, bottom: 0 });
  const full = settings.tunerStyle === 'full';

  useEffect(() => {
    const app = appRef.current;
    const zone = zoneRef.current;
    if (!app || !zone) return;
    if (!full) {
      app.style.removeProperty('--full-top');
      app.style.removeProperty('--full-bottom');
      setFullInset((prev) => (prev.top === 0 && prev.bottom === 0 ? prev : { top: 0, bottom: 0 }));
      return;
    }
    const measure = () => {
      const a = app.getBoundingClientRect();
      const z = zone.getBoundingClientRect();
      const next = {
        top: Math.max(0, Math.round(z.top - a.top)),
        bottom: Math.max(0, Math.round(a.bottom - z.bottom)),
      };
      app.style.setProperty('--full-top', `${next.top}px`);
      app.style.setProperty('--full-bottom', `${next.bottom}px`);
      // Same numbers, same object — this runs from a ResizeObserver, and a
      // fresh object every time would re-render, re-measure and never stop.
      setFullInset((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(app);
    ro.observe(zone);
    return () => ro.disconnect();
  }, [full]);

  useAppearance(
    settings.themeStyle,
    settings.themeMode,
    settings.themeColor,
    settings.hue,
    settings.colorStrength,
  );
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
      // Raised before the start and lowered once it settles, either way:
      // startMic swallows its own failures, so this is not an error path.
      setAutoStarting(true);
      void startMic().finally(() => setAutoStarting(false));
    };
    wake();
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [startMic]);

  /*
   * The graph can die without the engine noticing, and nothing else notices
   * either.
   *
   * iOS can take the audio session away across an app switch, and when it
   * does, no event this code listens for fires: `visibilitychange` may not
   * come, and `state` is set by AudioEngine alone so it still says running.
   * Every guard on the way back then agrees there is nothing to do —
   * `start()` returns early on a running engine and the resume handler above
   * returns early for the same reason — and the tuner sits there hearing
   * nothing until the app is force-quit. That is the report: it stops
   * picking up sound after you come back from another app.
   *
   * So this asks the one question that cannot be answered wrongly: is audio
   * arriving. Two seconds of being visible before it will act, because
   * nothing arrives while backgrounded and the first check after a resume
   * would otherwise see a stale clock and restart a graph that was about to
   * be fine.
   *
   * Native only. On the web the microphone needs a gesture to start and the
   * power button is right there; restarting without one is the change that
   * broke this app badly enough to be reverted once already.
   */
  useEffect(() => {
    if (!isNative()) return;
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
    /*
     * How many remedies have been tried since audio was last seen arriving.
     *
     * **The thing this counter exists to stop shipped once.** Without it the
     * check is "not capturing, so restart", every second, for as long as the
     * app is open -- and if restarting does not help, it never stops helping
     * either. The microphone goes down and up about twice a second, which on
     * the settings panel showed as a line of text under Microphone appearing
     * and vanishing and bouncing everything below it. A watchdog that cannot
     * give up is worse than no watchdog: a tuner that has quietly stopped
     * hearing is a bad afternoon, and a tuner rebuilding its audio graph
     * every second is a bad review.
     */
    let tried = 0;
    /** In flight, so a slow remedy is not started twice. */
    let busy = false;

    const onVisible = () => {
      visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
      // Each trip to another app gets its own budget: coming back is the
      // event this exists for, so it is the event that earns a fresh go.
      tried = 0;
    };
    document.addEventListener('visibilitychange', onVisible);

    const id = setInterval(() => {
      if (busy || !visibleSince || Date.now() - visibleSince < GRACE_MS) return;
      if (tuner.micState !== 'running') return;
      if (tuner.engine.capturing) {
        // Alive. Whatever was wrong is not wrong now.
        tried = 0;
        return;
      }
      if (tried >= MAX_REMEDIES) return;
      tried += 1;
      busy = true;
      // Each attempt gets the same grace the first one got, so a remedy is
      // judged on whether it worked rather than on how fast it was.
      visibleSince = Date.now();

      /*
       * Cheapest first. A context suspended out from under us runs no
       * worklet, which looks identical to the session being taken away and
       * is one call to fix; only if that is not it is the graph rebuilt.
       */
      void (async () => {
        try {
          if (tried === 1 && (await tuner.engine.resumeContext())) return;
          // Stop first: start() would refuse an engine that still says running.
          tuner.stopMic();
          await startMic();
        } catch {
          /* startMic has already put the error on screen */
        } finally {
          busy = false;
          visibleSince = Date.now();
        }
      })();
    }, 1000);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
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

  /*
   * What this Apple ID already owns, asked once on the way in.
   *
   * This is what makes a reinstall, a new handset or a restored backup come
   * back with the full set already open, without anyone having to know there
   * is a Restore button. It only ever turns the flag on — see
   * reconcileEntitlement.
   */
  useEffect(() => {
    void reconcileEntitlement();
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
      /* How wide the tuner screen is drawn — see .field-deck and TunerStyle.
         On the app rather than on the deck because the pager chevrons, which
         live outside it, have to move out of the way too. */
      data-tuner-style={settings.tunerStyle}
      /* Whether the pager chevrons are drawn. The accidentals sit beside them
         when they are, and take their place when they are not -- see
         .field__edge in app.css. */
      data-arrows={settings.showTunerArrows}
    >
      {debugRequested() && <DebugHud />}
      {/*
        Which build you are holding, as a word — see __BUILD_WORD__ in
        vite.config.ts. `npm run phone` only: it is '' in every other build, so
        this is a constant false that Rollup folds away, verified by grepping
        the bundle. Styled inline rather than from app.css deliberately, since
        a class in the stylesheet would ship whether or not anything wore it.

        Bottom left, because the wordmark runs the full width of the top edge;
        the app already reserves a band under the tuning row for the home
        indicator and draws nothing in it. pointer-events: none because it sits
        over a real target.
      */}
      {__BUILD_WORD__ ? (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 2px)',
            left: 4,
            zIndex: 70,
            padding: '1px 4px',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.04em',
            lineHeight: 1.3,
            color: 'var(--accent)',
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            borderRadius: 'var(--r-xs, 6px)',
            opacity: 0.75,
            pointerEvents: 'none',
          }}
        >
          {__BUILD_WORD__}
        </span>
      ) : null}
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
            title="Reference pitch, in-tune window and capo. Tap to change."
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
        {/*
          Taken out of the layout, not merely out of sight.
          
          These were hidden with visibility so nothing moved when they were
          switched, which was the wrong call: leaving a carousel-shaped hole
          above the tuner is exactly what makes the screen look off-centre once
          you have turned the carousel off. Unmounting hands the space to
          .field-zone, which is the flexible row, and its own grid re-centres
          the tuner inside whatever it ends up with.
        */}
        {settings.showCarousel && (
          <NoteDisplay
            naming={settings.naming}
            tolerance={settings.tolerance}
            fallbackMidi={fallbackMidi}
          />
        )}
        {/* The field is centred in this zone, which spans the full gap between
            the carousel and the string row. The frequency readout is pinned to
            the bottom of the zone so it cannot pull the field off centre. */}
        <div className="field-zone" ref={zoneRef}>
          {settings.showVerdict && <TuningVerdict tolerance={settings.tolerance} />}
          <TunerVisual
            visual={settings.visual}
            onChange={(visual) => settingsStore.set({ visual })}
            sampleRateLabel={sampleRateLabel}
            tolerance={settings.tolerance}
            // Hue is part of the key: the canvas caches its palette and must
            // re-read the custom properties when the screen is re-tinted.
            themeKey={`${settings.themeStyle}:${settings.themeMode}:${settings.themeColor}:${settings.hue}:${settings.colorStrength}`}
            naming={settings.naming}
            fallbackMidi={fallbackMidi}
            marks={settings.showTunerMarks}
            cents={settings.showCents}
            padTop={fullInset.top}
            padBottom={fullInset.bottom}
            trailWidth={settings.trailWidth}
            arrows={settings.showTunerArrows}
          />
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

      {/*
        The tuner stays on screen behind this, dimmed.

        On the web nothing starts without a real press, and that press is
        load-bearing: an AudioContext built outside a user gesture comes up
        suspended on iOS Safari. Removing it once before is what broke the
        tuner badly enough to be reverted, so the web path here is untouched.

        The packaged app is the opposite case and the comment above already
        said so — the gate is *the fallback for a start that was refused or
        failed* — while the condition rendered it whenever the microphone
        was not running, which is a different and much larger set. It
        included the moment after every return from the background, and iOS
        takes the app-switcher snapshot while the app is hidden, so the card
        you tap to come back could have the gate painted into it. Hence a
        prompt that flashes up for a split second on the way in and that no
        amount of care over render timing can remove, because by then it is
        a photograph.

        So on a device it appears only when there is something to say. A
        refusal or a failure still lands on exactly the screen it always
        did, carrying the error and a button to try again.
      */}
      {!running && !autoStarting && (!isNative() || micError !== null) && (
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
