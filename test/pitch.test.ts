/**
 * Accuracy harness for the pitch detector.
 *
 *   npm test
 *
 * Feeds synthetic instrument-like signals at known frequencies through
 * PitchDetector and asserts the error stays under a fraction of a cent — a
 * tuner that is visually beautiful but half a semitone out is worthless.
 */

import { PitchDetector, PitchTracker } from '../src/audio/pitch';
import { renderPluck } from '../src/audio/tone';
import {
  GATE_MAX,
  GATE_MIN,
  HOLD_DISAGREE_CENTS,
  ONSET_FLOOR_RATIO,
  followGateForNoiseFloor,
  AudioEngine,
  gateForNoiseFloor,
  nextNoiseFloor,
  tooFarToFollow,
} from '../src/audio/AudioEngine';

const SAMPLE_RATE = 48000;
const WINDOW = 4096;

/** A quiet room, in rms: -70 dBFS. What the gate is normally measured against. */
const QUIET_ROOM = 0.000316;
/**
 * The gate the sensitivity slider produced at its default position, before it
 * was removed. Several checks below are against this rather than against a
 * number of their own, because the point of them is that nothing moved.
 */
const OLD_DEFAULT_GATE = 0.001012;

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail: string): void {
  checks++;
  if (ok) {
    console.log(`  PASS  ${name}  ${detail}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

/** Deterministic PRNG so a failure is always reproducible. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface ToneOptions {
  harmonics?: number;
  /** Relative amplitude of harmonic k (1-indexed). */
  amplitude?: (k: number) => number;
  /** Exponential decay time constant in seconds. 0 = steady tone. */
  decay?: number;
  /** White noise amplitude relative to the signal peak. */
  noise?: number;
  /** DC offset / low-frequency rumble amplitude. */
  rumble?: number;
  seed?: number;
}

function synth(freq: number, length: number, opts: ToneOptions = {}): Float32Array {
  const {
    harmonics = 8,
    amplitude = (k: number) => 1 / k,
    decay = 0,
    noise = 0,
    rumble = 0,
    seed = 12345,
  } = opts;

  const rand = makeRandom(seed);
  const phases = Array.from({ length: harmonics }, () => rand() * Math.PI * 2);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (let k = 1; k <= harmonics; k++) {
      const partial = freq * k;
      if (partial > SAMPLE_RATE / 2) break;
      v += amplitude(k) * Math.sin(2 * Math.PI * partial * t + phases[k - 1]);
    }
    if (decay > 0) v *= Math.exp(-t / decay);
    if (rumble > 0) v += rumble * Math.sin(2 * Math.PI * 7 * t);
    if (noise > 0) v += noise * (rand() * 2 - 1);
    out[i] = v * 0.3;
  }
  return out;
}

function centsError(detected: number, expected: number): number {
  return 1200 * Math.log2(detected / expected);
}

/* -------------------------------------------------------------------------- */

console.log('\nPitch detector accuracy  (48 kHz, 4096-sample window)\n');

const detector = new PitchDetector(WINDOW, SAMPLE_RATE);

/* --- 1. clean instrument range ------------------------------------------- */
console.log('Clean harmonic tones across the instrument range');
const NOTES: [string, number][] = [
  ['B0  (5-string bass)', 30.868],
  ['E1  (bass E)', 41.203],
  ['A1', 55.0],
  ['E2  (guitar low E)', 82.407],
  ['A2', 110.0],
  ['D3', 146.832],
  ['G3', 195.998],
  ['B3', 246.942],
  ['E4  (guitar high E)', 329.628],
  ['A4', 440.0],
  ['E5  (violin E)', 659.255],
  ['A5', 880.0],
  ['E6', 1318.51],
];

let worst = 0;
for (const [name, freq] of NOTES) {
  const buf = synth(freq, WINDOW);
  const r = detector.detect(buf);
  const err = r.frequency > 0 ? centsError(r.frequency, freq) : NaN;
  worst = Math.max(worst, Math.abs(err));
  check(
    name.padEnd(22),
    r.frequency > 0 && Math.abs(err) < 1.0,
    `${freq.toFixed(2)} Hz -> ${r.frequency.toFixed(3)} Hz  (${err >= 0 ? '+' : ''}${err.toFixed(3)} cents, clarity ${r.clarity.toFixed(3)})`,
  );
}
console.log(`  worst-case error: ${worst.toFixed(3)} cents\n`);

/* --- 2. detuned targets --------------------------------------------------- */
console.log('Detuned strings (does the reported offset match reality?)');
for (const offset of [-49, -25, -12, -5, -1, 1, 5, 12, 25, 49]) {
  const target = 82.407;
  const actual = target * Math.pow(2, offset / 1200);
  const r = detector.detect(synth(actual, WINDOW));
  const reported = centsError(r.frequency, target);
  check(
    `low E ${offset >= 0 ? '+' : ''}${offset}`.padEnd(22),
    Math.abs(reported - offset) < 1.0,
    `reported ${reported >= 0 ? '+' : ''}${reported.toFixed(3)} cents (error ${(reported - offset).toFixed(3)})`,
  );
}
console.log('');

/* --- 3. plucked decay + noise --------------------------------------------- */
console.log('Realistic plucked notes: fast decay, room noise, mic rumble');
for (const [name, freq] of [
  ['E2 pluck', 82.407],
  ['A2 pluck', 110.0],
  ['G3 pluck', 195.998],
  ['E4 pluck', 329.628],
] as [string, number][]) {
  const buf = synth(freq, WINDOW, { decay: 0.9, noise: 0.03, rumble: 0.05, seed: 777 });
  const r = detector.detect(buf);
  const err = r.frequency > 0 ? centsError(r.frequency, freq) : NaN;
  check(
    name.padEnd(22),
    r.frequency > 0 && Math.abs(err) < 2.0,
    `${r.frequency.toFixed(3)} Hz  (${err >= 0 ? '+' : ''}${err.toFixed(3)} cents, clarity ${r.clarity.toFixed(3)})`,
  );
}
console.log('');

/* --- 4. missing fundamental (the classic octave trap) --------------------- */
console.log('Missing / weak fundamental — must not report an octave up');
for (const [name, freq] of [
  ['E2 no fundamental', 82.407],
  ['A1 weak fundamental', 55.0],
] as [string, number][]) {
  const buf = synth(freq, WINDOW, {
    harmonics: 10,
    amplitude: (k) => (k === 1 ? 0.02 : 1 / k),
  });
  const r = detector.detect(buf);
  const err = r.frequency > 0 ? centsError(r.frequency, freq) : NaN;
  check(
    name.padEnd(22),
    r.frequency > 0 && Math.abs(err) < 5.0,
    `${r.frequency.toFixed(3)} Hz  (${err >= 0 ? '+' : ''}${err.toFixed(2)} cents)`,
  );
}
console.log('');

/* --- 5. rejection --------------------------------------------------------- */
console.log('Rejection: silence and unpitched noise must report nothing');
{
  const silence = new Float32Array(WINDOW);
  const r = detector.detect(silence);
  check('digital silence'.padEnd(22), r.frequency === 0, `reported ${r.frequency}`);
}
{
  const rand = makeRandom(99);
  const noise = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) noise[i] = (rand() * 2 - 1) * 0.25;
  const r = detector.detect(noise);
  check(
    'white noise'.padEnd(22),
    r.frequency === 0,
    `reported ${r.frequency.toFixed(1)} Hz, clarity ${r.clarity.toFixed(3)}`,
  );
}
console.log('');

/* --- 6. tracker settling --------------------------------------------------- */
console.log('Tracker: settles onto a steady note, survives one bad frame');
{
  const tracker = new PitchTracker();
  const freq = 110.0;
  let last = 0;
  for (let i = 0; i < 40; i++) {
    // Frame 20 is a deliberate octave-error glitch from the detector.
    const raw =
      i === 20
        ? { frequency: freq * 2, clarity: 0.9, rms: 0.1 }
        : { frequency: freq, clarity: 0.95, rms: 0.1 };
    last = tracker.update(raw).frequency;
  }
  const err = centsError(last, freq);
  check(
    'steady A2 + glitch'.padEnd(22),
    Math.abs(err) < 1.0,
    `settled at ${last.toFixed(3)} Hz (${err.toFixed(3)} cents off)`,
  );
}
{
  /*
   * A decaying note starts offering poorly-resolved alternatives (a neighbour
   * string ringing, or correlated noise). A few of those must not drag the
   * reading off.
   *
   * This used to feed thirty of them and assert the reading never moved, which
   * is half a second and was the bug rather than the behaviour: with no bound
   * at all, the refusal could go on for as long as the disagreement did. It
   * was reported from a real guitar in Drop C# -- G#2 left ringing, C#2 struck
   * over and over -- where the detector found C#2 on nearly every frame and
   * the tracker refused 330 frames in a row, five and a half seconds, showing
   * G#2 throughout. A neighbour ringing sympathetically holds clarity down for
   * as long as it rings, so "low clarity" never expires on its own.
   *
   * Both halves are the test now: a brief disagreement is ignored, and one
   * that persists is eventually believed.
   */
  const brief = new PitchTracker();
  for (let i = 0; i < 30; i++) brief.update({ frequency: 110, clarity: 0.95, rms: 0.1 });
  let last = 110;
  for (let i = 0; i < 8; i++) {
    // 500 cents away — a perfect fourth up — but weakly resolved.
    last = brief.update({ frequency: 146.83, clarity: 0.7, rms: 0.02 }).frequency;
  }
  check(
    'ignores weak outliers'.padEnd(22),
    Math.abs(centsError(last, 110)) < 1.0,
    `stayed at ${last.toFixed(2)} Hz through 8 low-clarity frames a fourth away`,
  );

  const persistent = new PitchTracker();
  for (let i = 0; i < 30; i++) persistent.update({ frequency: 110, clarity: 0.95, rms: 0.1 });
  let moved = 110;
  for (let i = 0; i < 60; i++) {
    moved = persistent.update({ frequency: 146.83, clarity: 0.7, rms: 0.02 }).frequency;
  }
  check(
    'but not forever'.padEnd(22),
    Math.abs(centsError(moved, 146.83)) < 20,
    `followed to ${moved.toFixed(2)} Hz once the disagreement outlasted the budget`,
  );

  /*
   * And *how* it stops holding matters, which is the second half of the same
   * report.
   *
   * The first version of the budget fell through and adopted the disagreeing
   * reading. That fixed the note that would not let go and created a worse
   * fault: mute a string abruptly and the needle slid off onto whatever the
   * room had, because the only evidence available was the evidence the guard
   * had just spent a quarter second calling too weak to trust.
   *
   * So the note ends instead, and there must be a frame of *nothing* between
   * the old reading and whatever replaces it. That blank is not cosmetic: the
   * relaxed follow gate in AudioEngine applies only while a reading exists, so
   * giving up here is what puts the stricter acquire gate back in front of the
   * next candidate.
   */
  const giving = new PitchTracker();
  for (let i = 0; i < 30; i++) giving.update({ frequency: 110, clarity: 0.95, rms: 0.1 });
  let blanked = false;
  let heldAfterBudget = 0;
  for (let i = 0; i < 40; i++) {
    const out = giving.update({ frequency: 146.83, clarity: 0.7, rms: 0.02 });
    if (out.frequency === 0) blanked = true;
    else if (blanked) break;
    else if (Math.abs(centsError(out.frequency, 110)) < 1) heldAfterBudget = i + 1;
  }
  check(
    'gives up, not over'.padEnd(22),
    blanked,
    blanked
      ? `reading ended after ${heldAfterBudget} held frames rather than jumping to the weak one`
      : 'never blanked — it adopted the reading it had just refused',
  );
}
{
  // The same disagreement, but confidently resolved, should still be followed.
  const tracker = new PitchTracker();
  for (let i = 0; i < 30; i++) tracker.update({ frequency: 110, clarity: 0.95, rms: 0.1 });
  let last = 110;
  for (let i = 0; i < 30; i++) {
    last = tracker.update({ frequency: 146.83, clarity: 0.98, rms: 0.1 }).frequency;
  }
  check(
    'follows strong changes'.padEnd(22),
    Math.abs(centsError(last, 146.83)) < 1.0,
    `moved to ${last.toFixed(2)} Hz on confident frames`,
  );
}
{
  const tracker = new PitchTracker();
  for (let i = 0; i < 30; i++) tracker.update({ frequency: 110, clarity: 0.95, rms: 0.1 });
  let out = tracker.update({ frequency: 0, clarity: 0, rms: 0 });
  check(
    'holds through a gap'.padEnd(22),
    out.frequency > 0 && !out.active,
    `held ${out.frequency.toFixed(2)} Hz, active=${out.active}`,
  );
  for (let i = 0; i < 40; i++) out = tracker.update({ frequency: 0, clarity: 0, rms: 0 });
  check(
    'drops after silence'.padEnd(22),
    out.frequency === 0,
    `frequency=${out.frequency}`,
  );
}

/* --- 7. attack sharpening -------------------------------------------------- */
console.log('Attack: a freshly plucked string runs sharp and must not throw the needle');
/** Frames the engine spends flagging a note as still settling, at 60 Hz. */
const SETTLE_FRAMES = 15;

{
  const freq = 110.0;
  /**
   * Sharpness still on the note when the blanking period ends. The pick
   * transient itself never reaches the tracker; this is the residual tension
   * sharpening, decaying with roughly a quarter-second time constant.
   */
  const RESIDUAL_CENTS = 9;
  const FALLOFF = 15;

  /** Replays one pluck of a string the needle is already sitting on. */
  function pluck(settling: boolean): { peak: number; settled: number } {
    const tracker = new PitchTracker();
    for (let i = 0; i < 30; i++) tracker.update({ frequency: freq, clarity: 0.95, rms: 0.1 });

    tracker.noteAttack();
    let peak = 0;
    let last = freq;
    for (let i = 0; i < 60; i++) {
      const sharp = RESIDUAL_CENTS * Math.exp(-i / FALLOFF);
      last = tracker.update(
        { frequency: freq * Math.pow(2, sharp / 1200), clarity: 0.97, rms: 0.1 },
        settling && i < SETTLE_FRAMES,
      ).frequency;
      peak = Math.max(peak, centsError(last, freq));
    }
    return { peak, settled: centsError(last, freq) };
  }

  const damped = pluck(true);
  const raw = pluck(false);

  // The bar is the product one: a string that is in tune must stay inside the
  // default ±5¢ window when it is struck, not merely wobble less than before.
  check(
    'attack jolt damped'.padEnd(22),
    damped.peak < 5 && damped.peak < raw.peak * 0.7,
    `needle rose ${damped.peak.toFixed(2)} cents on a +${RESIDUAL_CENTS} cent attack ` +
      `(${raw.peak.toFixed(2)} undamped)`,
  );
  check(
    'settles back on pitch'.padEnd(22),
    Math.abs(damped.settled) < 0.5,
    `${damped.settled.toFixed(3)} cents off once the note settled`,
  );
}
{
  // The damping must not swallow a real change: turn the peg and re-pluck, and
  // the needle still has to get there.
  for (const turn of [20, 70]) {
    const tracker = new PitchTracker();
    for (let i = 0; i < 30; i++) tracker.update({ frequency: 110, clarity: 0.95, rms: 0.1 });
    tracker.noteAttack();
    const tightened = 110 * Math.pow(2, turn / 1200);
    let last = 110;
    let atSettleEnd = 0;
    for (let i = 0; i < 40; i++) {
      last = tracker.update(
        { frequency: tightened, clarity: 0.97, rms: 0.1 },
        i < SETTLE_FRAMES,
      ).frequency;
      if (i === SETTLE_FRAMES - 1) atSettleEnd = last;
    }
    const covered = (100 * (atSettleEnd - 110)) / (tightened - 110);
    check(
      `follows a +${turn}¢ peg turn`.padEnd(22),
      Math.abs(centsError(last, tightened)) < 1,
      `${covered.toFixed(0)}% covered while settling, ` +
        `${centsError(last, tightened).toFixed(2)} cents off after 0.66 s`,
    );
  }
}

/* --- 7b. quiet signals ----------------------------------------------------- */
// A note that has decayed a long way is still a note. The NSDF is normalised,
// so the detector's accuracy does not depend on level at all — the only thing
// that should ever end a note early is a threshold we chose.
console.log('Quiet signals: a decayed note is still a note');
{
  const detector = new PitchDetector(WINDOW, SAMPLE_RATE, 24, 2200);
  const freq = 110;
  const gate = GATE_MIN; // the most permissive the gate is ever allowed to be
  const base = synth(freq, WINDOW, { harmonics: 6 });
  let sum = 0;
  for (let i = 0; i < WINDOW; i++) sum += base[i] * base[i];
  const baseRms = Math.sqrt(sum / WINDOW);

  // Scaled by *rms*, since that is what the gate actually measures — a
  // harmonic-rich waveform's peak sits some 12 dB above its rms, and labelling
  // these by peak would quietly overstate how quiet they are.
  for (const db of [-30, -45, -60, -66]) {
    const quiet = new Float32Array(WINDOW);
    const scale = Math.pow(10, db / 20) / baseRms;
    for (let i = 0; i < WINDOW; i++) quiet[i] = base[i] * scale;
    const r = detector.detect(quiet, 0.42, gate);
    const err = centsError(r.frequency, freq);
    check(
      `A2 at ${db} dBFS rms`.padEnd(22),
      r.frequency > 0 && Math.abs(err) < 1,
      `${r.frequency.toFixed(3)} Hz (${err >= 0 ? '+' : ''}${err.toFixed(3)} cents)`,
    );
  }
  check(
    'gate floor'.padEnd(22),
    20 * Math.log10(GATE_MIN) < -65,
    `the gate bottoms out at ${(20 * Math.log10(GATE_MIN)).toFixed(1)} dBFS rms`,
  );
}

/* --- 8. reference tone ----------------------------------------------------- */
// The reference tone is synthesised by a waveguide whose loop length sets its
// pitch. Getting that length wrong by a fraction of a sample is worth tens of
// cents, so the tuner is pointed at its own tone generator and made to grade it.
console.log('Reference tone: the string model must be in tune with itself');
{
  const detector = new PitchDetector(WINDOW, SAMPLE_RATE, 24, 2200);
  // Every open string of a standard guitar, plus a cello C and a violin E.
  for (const [name, freq] of [
    ['E2', 82.4069],
    ['A2', 110.0],
    ['D3', 146.832],
    ['G3', 195.998],
    ['B3', 246.942],
    ['E4', 329.628],
    ['C2', 65.4064],
    ['E5', 659.255],
  ] as [string, number][]) {
    const rendered = renderPluck(SAMPLE_RATE, freq, 1.2);
    if (!rendered) {
      check(`tone ${name}`.padEnd(22), false, 'render returned nothing');
      continue;
    }
    // Measured a little way in, past the pick transient and the fade.
    const start = Math.round(SAMPLE_RATE * 0.25);
    const r = detector.detect(rendered.subarray(start, start + WINDOW));
    const err = centsError(r.frequency, freq);
    check(
      `tone ${name}`.padEnd(22),
      Math.abs(err) < 1.0,
      `${r.frequency.toFixed(3)} Hz (${err >= 0 ? '+' : ''}${err.toFixed(3)} cents, ` +
        `clarity ${r.clarity.toFixed(3)})`,
    );
  }
}
{
  // A pluck has to actually decay, or it is a drone with an attack.
  const rendered = renderPluck(SAMPLE_RATE, 110, 2.2)!;
  const rms = (from: number) => {
    let sum = 0;
    const n = 4096;
    for (let i = 0; i < n; i++) sum += rendered[from + i] ** 2;
    return Math.sqrt(sum / n);
  };
  const early = rms(Math.round(SAMPLE_RATE * 0.05));
  const late = rms(Math.round(SAMPLE_RATE * 1.5));
  const db = 20 * Math.log10(late / early);
  check(
    'tone decays'.padEnd(22),
    db < -12 && db > -60,
    `${db.toFixed(1)} dB from 50 ms to 1.5 s`,
  );
}
{
  /*
   * The twang test.
   *
   * A plucked string is bright for a moment and then warms; a naive
   * Karplus-Strong loop at 48 kHz barely damps its harmonics at all and keeps
   * an edge on the note the whole way down, which is what makes it sound like a
   * sitar. Brightness here is the share of a window's energy sitting up in the
   * treble, measured with a one-pole difference — crude, but it is a pure ratio
   * and it tracks the thing the ear objects to.
   *
   * The bar is an absolute one on the *sustain*, not a fall from the attack:
   * the two-point-average loop this replaced also fell to a tenth of its own
   * attack value, because the attack was that much brighter still. It carried
   * six times as much treble as this does through the body of a low E, which is
   * where the twang actually lived.
   */
  const SUSTAIN_BRIGHTNESS = 0.02;
  const brightness = (buf: Float32Array, from: number) => {
    const n = 8192;
    let hi = 0;
    let all = 0;
    for (let i = 1; i < n; i++) {
      const d = buf[from + i] - buf[from + i - 1];
      hi += d * d;
      all += buf[from + i] ** 2;
    }
    return all > 0 ? hi / all : 0;
  };
  for (const [name, freq] of [
    ['E2', 82.4069],
    ['A2', 110],
    ['E4', 329.628],
  ] as [string, number][]) {
    const rendered = renderPluck(SAMPLE_RATE, freq, 2.2)!;
    const attack = brightness(rendered, Math.round(SAMPLE_RATE * 0.03));
    const sustain = brightness(rendered, Math.round(SAMPLE_RATE * 0.4));
    check(
      `tone warms ${name}`.padEnd(22),
      sustain < SUSTAIN_BRIGHTNESS && sustain < attack * 0.5,
      `treble share ${attack.toFixed(4)} at the attack, ${sustain.toFixed(4)} in the sustain`,
    );
  }
}

/* --- 7c. a quiet instrument ------------------------------------------------ */
// An unplugged electric is some twenty decibels down on an acoustic, and every
// absolute threshold in the engine was calibrated on the loud one. Both of the
// floors that used to be fixed hang off the silence gate, so the whole
// detector moves together with the room the gate is measured from.
console.log('Quiet instruments: an unplugged electric is still a guitar');
{
  const detector = new PitchDetector(WINDOW, SAMPLE_RATE, 24, 2200);
  const freq = 82.407;
  const acquire = gateForNoiseFloor(QUIET_ROOM);
  const asDb = (x: number) => 20 * Math.log10(x);

  // The onset floor used to be a flat 0.0045 — thirteen decibels clear of the
  // gate. Anything in between was audible to the detector and invisible to the
  // note machinery, which is precisely where a quiet instrument sits.
  const onset = acquire * ONSET_FLOOR_RATIO;
  check(
    'onset floor tracks gate'.padEnd(22),
    onset < 0.0045 && asDb(onset) - asDb(acquire) < 8,
    `${asDb(onset).toFixed(1)} dBFS, ${(asDb(onset) - asDb(acquire)).toFixed(1)} dB over the gate`,
  );

  // Following a note we already have is a different question from acquiring
  // one, and gets a lower answer.
  const sustain = followGateForNoiseFloor(QUIET_ROOM);
  check(
    'sustain gate relaxes'.padEnd(22),
    asDb(acquire) - asDb(sustain) >= 6,
    `${asDb(sustain).toFixed(1)} dBFS while a note is on, ${asDb(acquire).toFixed(1)} to acquire`,
  );

  /*
   * And the one that was actually wrong. Expressed as a fraction of the
   * acquire gate it worked out below the room, and a gate under the noise
   * floor can never fire: once anything was on screen the level test stopped
   * guarding and a room with any hum in it kept the reading alive forever.
   */
  for (const [name, floor] of [
    ['a silent room', 0.0000316],
    ['a quiet room', QUIET_ROOM],
    ['a loud room', 0.00316],
  ] as [string, number][]) {
    const follow = followGateForNoiseFloor(floor);
    check(
      `above ${name}`.padEnd(22),
      follow > floor,
      `${asDb(follow).toFixed(1)} dBFS against a floor of ${asDb(floor).toFixed(1)}`,
    );
  }

  // And the detector has to actually be good down there, or relaxing the gate
  // only buys a longer stretch of nonsense.
  const base = synth(freq, WINDOW, { harmonics: 6 });
  let sum = 0;
  for (let i = 0; i < WINDOW; i++) sum += base[i] * base[i];
  const baseRms = Math.sqrt(sum / WINDOW);

  for (const db of [asDb(acquire) + 1, asDb(sustain) + 1]) {
    const quiet = new Float32Array(WINDOW);
    const scale = Math.pow(10, db / 20) / baseRms;
    for (let i = 0; i < WINDOW; i++) quiet[i] = base[i] * scale;
    const r = detector.detect(quiet, 0.42, sustain);
    const err = centsError(r.frequency, freq);
    check(
      `E2 at ${db.toFixed(0)} dBFS rms`.padEnd(22),
      r.frequency > 0 && Math.abs(err) < 1,
      `${r.frequency.toFixed(3)} Hz (${err >= 0 ? '+' : ''}${err.toFixed(3)} cents)`,
    );
  }
}

/* --- 7c2. holding a note through a dropout --------------------------------- */
// A decaying string spends its last second hovering right at the edge of what
// the detector can resolve, dipping under and coming back frame by frame. The
// tracker holds the reading across those gaps; the hold is the only reason the
// display does not strobe. It used to be counted in frames, which made it half
// as long on a 120 Hz screen as on a 60 Hz one.
console.log('Hold: a dropout is not the end of a note');
{
  /** Feeds `seconds` of nothing at `fps` and reports what survives. */
  const coast = (seconds: number, fps: number) => {
    const tracker = new PitchTracker();
    for (let i = 0; i < 30; i++) tracker.update({ frequency: 329.63, clarity: 0.95, rms: 0.1 }, false, 1 / fps);
    let out = { frequency: 0, active: false } as { frequency: number; active: boolean };
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      out = tracker.update({ frequency: 0, clarity: 0.2, rms: 0.001 }, false, 1 / fps);
    }
    return out;
  };

  for (const fps of [60, 120]) {
    const held = coast(0.4, fps);
    check(
      `holds 0.4 s at ${fps} Hz`.padEnd(22),
      held.frequency > 0 && Math.abs(centsError(held.frequency, 329.63)) < 1,
      `${held.frequency.toFixed(2)} Hz still on screen, active ${held.active}`,
    );
  }
  for (const fps of [60, 120]) {
    const gone = coast(0.6, fps);
    check(
      `drops it at ${fps} Hz`.padEnd(22),
      gone.frequency === 0,
      `gone after 0.6 s of nothing`,
    );
  }

  // The point of the hold: the value survives, so anything reading `frequency`
  // rather than `active` rides straight through a one-frame dropout.
  const tracker = new PitchTracker();
  for (let i = 0; i < 30; i++) tracker.update({ frequency: 329.63, clarity: 0.95, rms: 0.1 });
  const blip = tracker.update({ frequency: 0, clarity: 0.3, rms: 0.01 });
  check(
    'one bad frame is a blip'.padEnd(22),
    blip.frequency > 0 && !blip.active,
    `${blip.frequency.toFixed(2)} Hz held with active=false`,
  );
}

/* --- 7c3. a re-arming attack blank must not freeze the display ------------- */
// analyse() holds the previous reading while the pick transient is still in
// the window. That blank is 213 ms, but a fresh onset re-arms it after 34 ms,
// so anything firing onsets faster than the blank expires used to freeze the
// reading on screen indefinitely — perfectly steady, with nothing counting
// down, because the tracker was never consulted and its hold never started.
console.log('Attack blank: a frozen reading still has to expire');
{
  const engine = new AudioEngine() as unknown as {
    detector: PitchDetector;
    sampleRate: number;
    state: string;
    push(s: Float32Array): void;
    analyse(): { frequency: number };
  };
  engine.detector = new PitchDetector(WINDOW, SAMPLE_RATE, 46.25, 493.9);
  engine.sampleRate = SAMPLE_RATE;
  engine.state = 'running';

  const CHUNK = Math.round(SAMPLE_RATE / 60);
  const chunk = new Float32Array(CHUNK);
  const tone = synth(196, SAMPLE_RATE * 2, { harmonics: 6 });

  // A second of a real note, to get a reading on screen.
  let read = 0;
  for (let at = 0; at + CHUNK < SAMPLE_RATE; at += CHUNK) {
    chunk.set(tone.subarray(at, at + CHUNK));
    engine.push(chunk);
    read = engine.analyse().frequency;
  }
  check(
    'a reading to freeze'.padEnd(22),
    read > 0,
    `${read.toFixed(1)} Hz on screen before the bursts start`,
  );

  // Now nothing but a burst every 50 ms: loud, abrupt, and far too fast for
  // the blank to ever expire between them.
  const rand = makeRandom(31337);
  let frames = 0;
  let stillShowing = 0;
  for (let i = 0; i < 180; i++) {
    // 3 s at 60 fps
    const burst = i % 3 === 0;
    for (let j = 0; j < CHUNK; j++) {
      chunk[j] = burst ? (rand() * 2 - 1) * 0.25 : (rand() * 2 - 1) * 0.0002;
    }
    engine.push(chunk);
    const f = engine.analyse().frequency;
    frames++;
    if (f > 0) stillShowing = frames;
  }
  check(
    'the freeze expires'.padEnd(22),
    stillShowing / 60 < 1.0,
    `reading gone ${(stillShowing / 60).toFixed(2)} s into a 3 s burst train`,
  );
}

/* --- 7d. the room sets the gate -------------------------------------------- */
// There was a Sensitivity slider, and now the silence gate is measured from
// the room instead. An adaptive floor was tried here once and reverted, for a
// reason worth having a test for rather than a comment: it averaged, so a long
// note dragged it up toward the note's own level and the gate cut the note off.
// Every check below is about the asymmetry that stops that — playing can only
// make a room louder, so a rise is never evidence.
console.log('Noise floor: the room may lower the gate, a note may not raise it');
{
  const asDb = (x: number) => 20 * Math.log10(x);
  const FRAME = 1 / 60;
  /** Runs the tracker for `seconds` of frames at a fixed level. */
  const run = (floor: number, env: number, seconds: number, noteOn: boolean) => {
    let f = floor;
    for (let i = 0; i < Math.round(seconds / FRAME); i++) f = nextNoiseFloor(f, env, FRAME, noteOn);
    return f;
  };

  check(
    'seeds from the room'.padEnd(22),
    nextNoiseFloor(0, QUIET_ROOM, FRAME, false) === QUIET_ROOM,
    `first frame adopts ${asDb(QUIET_ROOM).toFixed(1)} dBFS outright`,
  );

  // The reverted bug, stated as an assertion. Forty decibels up for ten
  // seconds is a struck open string, and it must not move the floor at all.
  const held = run(QUIET_ROOM, QUIET_ROOM * 100, 10, true);
  check(
    'a note cannot lift it'.padEnd(22),
    held === QUIET_ROOM,
    `10 s at +40 dB with a note on moved it ${asDb(held / QUIET_ROOM).toFixed(2)} dB`,
  );

  // Nothing else may lift it quickly either, note or not.
  const crept = run(QUIET_ROOM, QUIET_ROOM * 30, 1, false);
  check(
    'a rise is distrusted'.padEnd(22),
    asDb(crept / QUIET_ROOM) < 12,
    `1 s at +30 dB with no note on moved it ${asDb(crept / QUIET_ROOM).toFixed(1)} dB`,
  );

  // A fall is the opposite: a quieter room is believed almost at once, which
  // is what keeps a bad estimate from outliving the thing that caused it.
  const dropped = run(QUIET_ROOM * 30, QUIET_ROOM, 1, false);
  check(
    'a fall is believed'.padEnd(22),
    asDb(dropped / QUIET_ROOM) < 1,
    `back within ${asDb(dropped / QUIET_ROOM).toFixed(2)} dB of the room after 1 s`,
  );

  check(
    'clamped at both ends'.padEnd(22),
    gateForNoiseFloor(0) === GATE_MIN && gateForNoiseFloor(1) === GATE_MAX,
    `${asDb(GATE_MIN).toFixed(1)} to ${asDb(GATE_MAX).toFixed(1)} dBFS, the old slider's range`,
  );

  // The one that says removing the slider changed nothing anyone will hear.
  const quiet = gateForNoiseFloor(QUIET_ROOM);
  check(
    'a quiet room = the old'.padEnd(22),
    Math.abs(asDb(quiet) - asDb(OLD_DEFAULT_GATE)) < 1.5,
    `${asDb(quiet).toFixed(1)} dBFS against the slider default's ${asDb(OLD_DEFAULT_GATE).toFixed(1)}`,
  );
}

/* --- 7e. following a note down, not onto another one ----------------------- */
// The relaxed gate buys the tail of a note. It must not also buy a different
// note: late in a decay the played string and whatever else is ringing are
// comparable in level, their sum is honestly periodic at a common sub-multiple,
// and MPM reports that with high clarity because it is true. Reported from a
// real guitar as the reading dropping to about -2780 cents mid-decay.
console.log('Following: a sub-multiple is a slip, a neighbour is a note');
{
  const E2 = 82.407, A2 = 110, G3 = 195.998, B3 = 246.942, E4 = 329.628;
  const D2 = 73.416; // drop D / DADGAD, the widest adjacent pair in common use

  const slips: [string, number, number][] = [
    ['E4 -> E4/5', E4, E4 / 5],
    ['E4 -> E4/4', E4, E4 / 4],
    ['E4 -> octave down', E4, E4 / 2],
    ['E2 -> octave up', E2, E2 * 2],
  ];
  for (const [name, from, to] of slips) {
    check(name.padEnd(22), tooFarToFollow(from, to), `${to.toFixed(1)} Hz refused`);
  }

  const notes: [string, number, number][] = [
    ['E2 -> A2', E2, A2],
    ['B3 -> G3', B3, G3],
    ['D2 -> A2 (a fifth)', D2, A2],
    ['E2 -> E2 +80c', E2, E2 * Math.pow(2, 80 / 1200)],
  ];
  for (const [name, from, to] of notes) {
    check(name.padEnd(22), !tooFarToFollow(from, to), `${to.toFixed(1)} Hz followed`);
  }

  // The threshold has to sit in the gap between those two groups, and the gap
  // is not wide. Pin both edges.
  check(
    'threshold in the gap'.padEnd(22),
    HOLD_DISAGREE_CENTS > 700 && HOLD_DISAGREE_CENTS < 1200,
    `${HOLD_DISAGREE_CENTS}¢: over a fifth, under an octave`,
  );
}

/* --- 7f. a real guitar --------------------------------------------------- */
// The only test here taken from an instrument rather than from a synthesiser,
// and it exists because six days of synthetic scenes failed to reproduce what
// one recording showed in a minute.
//
// Drop C# on an unplugged electric. G#2 is played, then damped briefly and C#2
// is struck over and over. Reported symptom: the display stayed on G#2, frozen
// at the last cent value it had, however hard C#2 was plucked -- and cleared
// only after a couple of seconds of silence.
//
// The numbers below are what the *detector* produced, frame by frame, from
// that recording: it found C#2 correctly on nearly every frame. The fault was
// entirely downstream, in the tracker, which refused all of them. So the
// detector's output is the right fixture -- it is exactly what the tracker
// consumes, it is a few kilobytes rather than a few megabytes, and it pins the
// layer the bug was actually in.
console.log('A real guitar: Drop C#, G#2 ringing, C#2 struck');
{
  /** [frequency Hz, clarity] per frame at 60 fps, t = 0.6 s .. 6.0 s. */
  const FRAMES: [number, number][] = [
   [104.0,0.76], [104.0,0.76], [104.0,0.78], [104.0,0.78], [104.0,0.80], [104.0,0.80],
    [103.9,0.76], [104.0,0.72], [103.9,0.70], [103.9,0.65], [103.8,0.66], [103.9,0.68],
    [103.9,0.69], [103.9,0.70], [103.9,0.69], [103.9,0.69], [103.9,0.67], [103.9,0.69],
    [104.0,0.68], [104.0,0.71], [51.9,0.78], [51.9,0.77], [51.9,0.79], [51.9,0.77], [51.9,0.62],
    [51.9,0.47], [103.7,0.36], [232.2,0.26], [239.8,0.20], [104.5,0.41], [104.6,0.60],
    [104.7,0.69], [104.7,0.73], [104.7,0.82], [104.6,0.81], [104.6,0.76], [104.5,0.76],
    [104.4,0.76], [104.4,0.77], [104.4,0.80], [104.4,0.86], [104.4,0.85], [104.4,0.84],
    [104.3,0.85], [104.3,0.84], [104.3,0.82], [104.3,0.84], [104.3,0.84], [104.3,0.84],
    [104.3,0.84], [104.3,0.85], [104.3,0.79], [104.3,0.76], [104.3,0.75], [104.3,0.66],
    [213.1,0.53], [213.7,0.60], [69.8,0.49], [52.1,0.49], [0,0.70], [0,0.67], [0,0.33],
    [0,0.46], [0,0.46], [70.1,0.43], [240.0,0.41], [70.1,0.49], [70.0,0.59], [69.9,0.59],
    [69.8,0.59], [69.8,0.62], [69.7,0.65], [69.6,0.68], [69.5,0.69], [69.5,0.71], [69.5,0.71],
    [69.5,0.70], [69.4,0.69], [69.5,0.69], [69.4,0.70], [69.3,0.69], [69.3,0.71], [69.2,0.72],
    [69.2,0.71], [69.2,0.70], [69.2,0.71], [69.2,0.72], [69.2,0.71], [69.1,0.74], [69.0,0.76],
    [69.0,0.77], [69.0,0.79], [69.0,0.78], [69.1,0.77], [69.0,0.77], [68.9,0.77], [68.9,0.76],
    [69.0,0.77], [68.9,0.75], [68.9,0.75], [68.9,0.75], [68.9,0.75], [68.9,0.75], [68.9,0.75],
    [68.9,0.75], [68.9,0.75], [68.9,0.75], [68.9,0.75], [68.9,0.75], [68.9,0.75], [68.9,0.75],
    [68.9,0.75], [68.9,0.75], [69.5,0.73], [69.4,0.75], [69.4,0.77], [69.4,0.77], [69.4,0.76],
    [69.4,0.74], [69.3,0.75], [69.4,0.75], [69.3,0.74], [69.3,0.75], [69.3,0.78], [69.3,0.78],
    [69.2,0.78], [69.2,0.78], [69.2,0.76], [69.2,0.76], [69.2,0.76], [69.2,0.76], [69.2,0.76],
    [69.2,0.76], [69.2,0.76], [69.2,0.76], [69.2,0.76], [69.2,0.76], [69.2,0.76], [69.2,0.76],
    [69.2,0.76], [69.2,0.76], [69.2,0.76], [69.5,0.77], [69.4,0.78], [69.4,0.78], [69.4,0.79],
    [69.3,0.80], [69.3,0.81], [69.3,0.81], [69.3,0.81], [69.2,0.81], [69.2,0.81], [69.2,0.81],
    [69.2,0.81], [69.2,0.81], [69.2,0.81], [69.2,0.81], [69.2,0.81], [69.2,0.81], [69.2,0.81],
    [69.2,0.81], [69.2,0.81], [69.2,0.81], [69.2,0.81], [69.2,0.81], [69.7,0.68], [69.6,0.70],
    [69.6,0.71], [69.6,0.71], [69.5,0.73], [69.5,0.72], [69.5,0.73], [69.4,0.74], [69.4,0.64],
    [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51],
    [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51], [69.5,0.51],
    [69.5,0.51], [69.6,0.63], [69.5,0.66], [69.5,0.67], [69.5,0.67], [69.4,0.70], [69.5,0.58],
    [0,0.58], [0,0.52], [0,0.49], [0,0.28], [0,0.27], [241.9,0.39], [242.4,0.45], [69.5,0.58],
    [69.5,0.60], [69.4,0.63], [69.4,0.65], [69.4,0.65], [69.4,0.65], [69.4,0.65], [69.4,0.67],
    [69.4,0.68], [69.4,0.70], [69.3,0.72], [69.3,0.73], [69.3,0.68], [249.2,0.29], [245.0,0.31],
    [245.0,0.31], [245.0,0.31], [241.2,0.32], [241.8,0.42], [74.5,0.56], [74.5,0.56],
    [74.5,0.59], [74.5,0.57], [74.5,0.55], [74.6,0.54], [69.8,0.59], [69.8,0.61], [69.8,0.63],
    [69.7,0.66], [69.6,0.67], [69.6,0.69], [69.6,0.66], [69.6,0.28], [240.9,0.26], [244.3,0.31],
    [244.1,0.32], [244.1,0.33], [243.1,0.45], [242.8,0.45], [241.8,0.46], [70.0,0.57],
    [70.0,0.60], [69.9,0.65], [69.9,0.66], [69.9,0.67], [69.8,0.70], [69.8,0.73], [69.8,0.74],
    [69.7,0.75], [69.7,0.75], [69.6,0.69], [69.6,0.35], [208.0,0.24], [241.2,0.22],
    [241.2,0.25], [241.2,0.27], [242.4,0.46], [242.7,0.53], [242.5,0.58], [69.8,0.63],
    [69.8,0.66], [69.8,0.66], [69.8,0.68], [69.8,0.68], [69.8,0.71], [69.8,0.74], [69.7,0.73],
    [69.6,0.72], [69.5,0.59], [69.5,0.59], [69.5,0.59], [69.5,0.59], [69.5,0.59], [69.5,0.59],
    [69.5,0.59], [69.5,0.59], [69.5,0.59], [69.5,0.59], [69.5,0.59], [69.5,0.59], [69.5,0.59],
    [69.5,0.59], [69.5,0.59], [242.4,0.40], [69.7,0.52], [69.6,0.56], [69.6,0.50], [69.5,0.44],
    [69.6,0.32], [0,0.28], [0,0.28], [0,0.28], [0,0.28], [0,0.28], [0,0.28], [0,0.28], [0,0.28],
    [0,0.28], [0,0.28], [0,0.28], [0,0.28], [0,0.28], [0,0.28], [0,0.28], [69.9,0.70],
    [69.9,0.70], [69.9,0.73], [69.9,0.73], [69.9,0.73], [69.9,0.73], [69.9,0.73], [69.9,0.73],
    [69.9,0.73], [69.9,0.73], [69.9,0.73], [69.9,0.73], [69.9,0.73], [69.9,0.73], [69.9,0.73],
    [69.9,0.73], [69.9,0.73], [69.9,0.73], [70.1,0.69]
  ];

  const C2 = 69.296; // the string being struck
  const G2 = 103.826; // the one left ringing

  const tracker = new PitchTracker();
  let onC = 0;
  let onG = 0;
  for (const [frequency, clarity] of FRAMES) {
    const out = tracker.update({ frequency, clarity, rms: 0.01 }, false, 1 / 60);
    if (out.frequency > 0) {
      if (Math.abs(centsError(out.frequency, C2)) < 60) onC++;
      else if (Math.abs(centsError(out.frequency, G2)) < 60) onG++;
    }
  }

  // The detector found C#2 on most of these frames. Before the disagreement
  // guard was given a budget the tracker showed G#2 for 330 frames in a row.
  check(
    'follows the struck string'.padEnd(22),
    onC > onG * 2,
    `C#2 on ${onC} frames, G#2 on ${onG}`,
  );
  check(
    'lets go of the old one'.padEnd(22),
    onG < FRAMES.length / 3,
    `${onG}/${FRAMES.length} frames still on the string that was only ringing`,
  );
}

/* -------------------------------------------------------------------------- */

console.log(
  `\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ''}\n`,
);
process.exit(failures ? 1 : 0);
