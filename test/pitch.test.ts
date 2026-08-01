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
import { sensitivityToDb, sensitivityToRmsGate } from '../src/state/store';

const SAMPLE_RATE = 48000;
const WINDOW = 4096;

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
  // A decaying note starts offering poorly-resolved alternatives (a neighbour
  // string ringing, or correlated noise). Those must not drag the reading off.
  const tracker = new PitchTracker();
  for (let i = 0; i < 30; i++) tracker.update({ frequency: 110, clarity: 0.95, rms: 0.1 });
  let last = 110;
  for (let i = 0; i < 30; i++) {
    // 500 cents away — a perfect fourth up — but weakly resolved.
    last = tracker.update({ frequency: 146.83, clarity: 0.7, rms: 0.02 }).frequency;
  }
  check(
    'ignores weak outliers'.padEnd(22),
    Math.abs(centsError(last, 110)) < 1.0,
    `stayed at ${last.toFixed(2)} Hz through 30 low-clarity frames a fourth away`,
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
  const gate = sensitivityToRmsGate(0); // the most permissive setting
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
    sensitivityToDb(0) < -65,
    `most permissive setting is ${sensitivityToDb(0).toFixed(1)} dBFS rms`,
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

/* -------------------------------------------------------------------------- */

console.log(
  `\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ''}\n`,
);
process.exit(failures ? 1 : 0);
