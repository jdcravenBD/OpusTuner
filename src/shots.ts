/**
 * A rig for taking App Store screenshots, behind `?shots` in dev only.
 *
 * The problem it solves is not the resolution, which the browser's own device
 * emulation handles. It is that a tuner with nothing to listen to is a picture
 * of a tuner doing nothing: no note, no needle, no strobe, the display sitting
 * at two dashes. Granting a real microphone and whistling at the laptop is not
 * repeatable, and it is not in tune.
 *
 * So this hands the app a synthetic instrument. `getUserMedia` is replaced with
 * a stream carrying a note and three of its harmonics, because a bare sine is
 * not what a string sounds like and the detector is entitled to see a real
 * spectrum. Everything downstream of the microphone is the real code doing real
 * work: the same pitch detection, the same smoothing, the same needle.
 *
 * It also unlocks the full set, since a screenshot of a locked feature is not
 * what anyone wants on a store page. **That sticks.** `owned` is a stored
 * setting like any other, so it survives leaving this URL, and the app then
 * looks paid-for on plain `/` until the settings are reset. That has already
 * caused one round of "why is everything unlocked", so the console line below
 * says so on the way in.
 *
 * ## Using it
 *
 *   npm run dev, then open http://localhost:5440/?shots
 *
 * Tap the power button once, because starting audio still needs a real gesture
 * and faking that would be faking the wrong thing. Then from the console:
 *
 *   __shots.cents(7)      seven cents sharp of whatever string is selected
 *   __shots.hz(146.83)    a specific frequency, if you want a specific note
 *
 * Compiled out of production entirely: main.tsx only imports this module when
 * DEV is set, so the branch and the chunk both disappear from a real build.
 */

import { settingsStore } from './state/store';
import { tuner } from './tuner/TunerController';

/** Low E on a guitar in standard tuning, which is where the app opens. */
const DEFAULT_HZ = 82.41;

/**
 * Relative levels for the fundamental and the next three harmonics.
 *
 * Roughly a plucked string: strong fundamental, an octave at about half, and
 * the rest falling away. The exact numbers matter less than their being there
 * at all, since a pure sine is the one signal a pitch detector never meets.
 */
const HARMONICS: [number, number][] = [
  [1, 1],
  [2, 0.45],
  [3, 0.22],
  [4, 0.12],
];

interface Rig {
  /** The synthetic instrument's own context, for when it stops singing. */
  readonly context: AudioContext | null;
  /** Play this exact frequency. */
  hz(frequency: number): void;
  /** Play this many cents away from the string currently being tuned to. */
  cents(offset: number): void;
  /** What is being played now. */
  readonly playing: number;
}

let oscillators: OscillatorNode[] = [];
let fakeContext: AudioContext | null = null;
let current = DEFAULT_HZ;

function retune(frequency: number): void {
  current = frequency;
  oscillators.forEach((osc, i) => {
    osc.frequency.value = frequency * HARMONICS[i][0];
  });
}

export function installScreenshotRig(): void {
  settingsStore.set({ owned: true });

  navigator.mediaDevices.getUserMedia = async () => {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor();
    fakeContext = ctx;
    const destination = ctx.createMediaStreamDestination();

    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(destination);

    oscillators = HARMONICS.map(([multiple, level]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = current * multiple;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain).connect(master);
      osc.start();
      return osc;
    });

    await ctx.resume();
    return destination.stream;
  };

  const rig: Rig = {
    get context() {
      return fakeContext;
    },
    hz: retune,
    cents(offset) {
      // Against the string the app is aiming at, so the needle lands where the
      // number says it will whichever string is selected.
      const target = tuner.frame.targetFreq;
      const base = target > 0 ? target : DEFAULT_HZ;
      retune(base * Math.pow(2, offset / 1200));
    },
    get playing() {
      return current;
    },
  };
  (window as unknown as Record<string, unknown>).__shots = rig;

  // eslint-disable-next-line no-console
  console.info(
    [
      'Screenshot rig on. Tap the power button, then:',
      '  __shots.cents(7)     seven cents sharp of the selected string',
      '  __shots.hz(146.83)   a specific note',
      '',
      'The full set is now unlocked, and that is a saved setting: it stays',
      'unlocked on plain / too. Settings > Reset settings puts it back, or',
      'run localStorage.clear() here.',
    ].join(String.fromCharCode(10)),
  );
}
