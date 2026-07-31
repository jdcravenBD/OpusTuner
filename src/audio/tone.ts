/**
 * Reference-tone playback: tap a string to hear the pitch you're aiming for.
 *
 * A digital waveguide — Karplus-Strong with the usual extensions — rather than
 * a stack of sine oscillators. A plucked string is a delay line with a lossy
 * filter round the loop, and modelling it that way gets the things that make it
 * sound like a *string* for free: the broadband snap of the attack, harmonics
 * that die at different rates so the tone darkens as it rings, and the comb
 * notches from picking somewhere other than the exact middle. Additive
 * synthesis can approximate all of it, but only by hand, and it still arrives
 * sounding like a tuned bell.
 *
 * Uses its own lazily-created AudioContext so it works whether or not the
 * microphone has been started.
 */

/** Voices allowed to overlap. Strumming a tuning should ring, not stutter. */
const MAX_VOICES = 6;
/** How many rendered plucks to keep. A tuner replays the same six pitches. */
const CACHE_SIZE = 12;

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  endsAt: number;
}

export class ToneEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  private cache = new Map<string, AudioBuffer>();

  volume = 0.55;

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      this.master = this.buildBody(this.ctx);
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /**
   * The body. A bare string model sounds thin and buzzy — what makes an
   * acoustic guitar is the box: the air cavity around 100 Hz, the top plate an
   * octave above, a scoop through the range where steel strings get their
   * nasal edge, and a roll-off well before the top of the spectrum.
   *
   * The limiter on the end is not a nicety. Six strings ringing together, each
   * through two resonant boosts, sums past full scale easily, and clipping in
   * the output stage is by some distance the harshest thing this app can do.
   */
  private buildBody(ctx: AudioContext): GainNode {
    const input = ctx.createGain();
    input.gain.value = 1;

    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 62;
    rumble.Q.value = 0.7;

    const air = ctx.createBiquadFilter();
    air.type = 'peaking';
    air.frequency.value = 102;
    air.Q.value = 1.4;
    air.gain.value = 3.5;

    const plate = ctx.createBiquadFilter();
    plate.type = 'peaking';
    plate.frequency.value = 214;
    plate.Q.value = 1.8;
    plate.gain.value = 2.5;

    const edge = ctx.createBiquadFilter();
    edge.type = 'peaking';
    edge.frequency.value = 2600;
    edge.Q.value = 0.9;
    edge.gain.value = -3.5;

    const top = ctx.createBiquadFilter();
    top.type = 'lowpass';
    top.frequency.value = 6000;
    top.Q.value = 0.6;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;

    input.connect(rumble);
    rumble.connect(air);
    air.connect(plate);
    plate.connect(edge);
    edge.connect(top);
    top.connect(limiter);
    limiter.connect(ctx.destination);
    return input;
  }

  /** Must be called from inside a user gesture at least once on iOS. */
  unlock(): void {
    this.ensure();
  }

  /** Plays a plucked reference tone at `freq` Hz. */
  play(freq: number, durationMs = 2200): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !isFinite(freq) || freq <= 0) return;

    const now = ctx.currentTime;
    this.reap(now);
    // Strings ring over each other, but not without limit.
    while (this.voices.length >= MAX_VOICES) this.release(this.voices.shift()!, now, 0.05);

    const buffer = this.render(ctx, freq, durationMs / 1000);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = this.volume * 0.45;

    source.connect(gain);
    gain.connect(this.master);
    source.start(now);

    const voice: Voice = { source, gain, endsAt: now + buffer.duration };
    this.voices.push(voice);
    source.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    };
  }

  /** Renders a pluck into an AudioBuffer, memoised by pitch and length. */
  private render(ctx: AudioContext, freq: number, seconds: number): AudioBuffer | null {
    const key = `${ctx.sampleRate}:${freq.toFixed(3)}:${seconds.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const samples = renderPluck(ctx.sampleRate, freq, seconds);
    if (!samples) return null;

    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);

    if (this.cache.size >= CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(key, buffer);
    return buffer;
  }

  /** Two-note rising confirmation, played when a string lands in tune. */
  chime(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    [
      [1174.66, 0],
      [1567.98, 0.085],
    ].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + offset;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(this.volume * 0.16, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  /** Damps every ringing string, the way a palm across them would. */
  stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const voice of this.voices) this.release(voice, now, 0.05);
    this.voices = [];
  }

  private release(voice: Voice, now: number, seconds: number): void {
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      voice.source.stop(now + seconds + 0.02);
    } catch {
      /* already stopped */
    }
  }

  /** Drops voices whose buffers have run out but whose `onended` was missed. */
  private reap(now: number): void {
    this.voices = this.voices.filter((v) => v.endsAt > now);
  }

  dispose(): void {
    this.stop();
    this.cache.clear();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }
}

export const toneEngine = new ToneEngine();

/** Frequency at which the loop's brightness decay is specified. */
const BRIGHT_HZ = 2400;
/** ...and how fast content there should die, in dB per second. */
const BRIGHT_DB_PER_SEC = 34;
/**
 * Ceiling on the loop filter's damping term. Past 0.5 the filter inverts at
 * Nyquist and the loop stops being a decay.
 */
const MAX_DAMP = 0.46;

/**
 * Synthesises one plucked string.
 *
 * Two things have to be true at once, and they pull against each other.
 *
 * **It has to be in tune.** The waveguide loop must delay by exactly
 * `sampleRate / freq` samples, and an integer delay line alone is up to fifteen
 * cents out at guitar pitches. So the loop length is made of three parts: the
 * integer line, the loop filter's own delay, and an allpass section for the
 * remaining fraction. That only works because the loop filter is *linear
 * phase* — it delays every frequency by exactly one sample, so it cannot pull
 * the pitch about. The allpass is exact only at DC, but a guitar's fundamental
 * sits well under a thousandth of the sample rate, where the error is far
 * beyond hearing. `npm test` renders this and measures it.
 *
 * **It has to darken as it rings.** The textbook two-point average is a
 * disaster at 48 kHz: every guitar harmonic lands in the flat part of its
 * response, so the twentieth partial decays barely faster than the fundamental
 * and the note stays bright to the end. That is what a sitar does, and it is
 * exactly the twang. The three-tap filter below keeps the linear phase but has
 * a damping term that can be dialled — and it is set from the *wanted* decay at
 * a fixed frequency, so a low E and a high E darken at the same rate in seconds
 * rather than in periods.
 *
 * Exported separately from the engine so the test can run it with no
 * AudioContext in sight.
 */
export function renderPluck(fs: number, freq: number, seconds: number): Float32Array | null {
  const period = fs / freq;
  if (!isFinite(period) || period <= 6) return null;

  // The three-tap loop filter contributes exactly 1 sample at every frequency.
  const lineLength = Math.floor(period - 1);
  const fraction = period - lineLength - 1;
  // Allpass coefficient for a delay of `fraction` samples.
  const apC = (1 - fraction) / (1 + fraction);

  const total = Math.max(1, Math.ceil(seconds * fs));
  const out = new Float32Array(total);

  /* --- excitation ------------------------------------------------------- */
  const line = new Float32Array(lineLength);
  const rand = makeRandom(Math.round(freq * 1000));
  // Low-passed noise, around 1.6 kHz: how hard and how soft the pick is. Pure
  // white is a plectrum made of glass.
  const pickTone = 1 - Math.exp((-2 * Math.PI * 1600) / fs);
  let lp = 0;
  for (let i = 0; i < lineLength; i++) {
    lp += (rand() * 2 - 1 - lp) * pickTone;
    line[i] = lp;
  }
  // Pluck position, as a fraction of the string from the bridge. Every harmonic
  // that has a node here is cancelled, which is the comb that stops a waveguide
  // sounding like a filtered buzz — and moving the point away from the bridge
  // is what takes the hardness out of it.
  const pluckAt = Math.max(1, Math.round(lineLength * 0.28));
  const shaped = new Float32Array(lineLength);
  for (let i = 0; i < lineLength; i++) {
    shaped[i] = line[i] - line[(i + pluckAt) % lineLength];
  }
  let peak = 0;
  for (let i = 0; i < lineLength; i++) peak = Math.max(peak, Math.abs(shaped[i]));
  const norm = peak > 1e-6 ? 0.72 / peak : 0;
  for (let i = 0; i < lineLength; i++) line[i] = shaped[i] * norm;

  /* --- decay ------------------------------------------------------------- */
  // Bass strings ring longer than treble ones, so the overall loss is set from
  // a wanted decay time rather than being a fixed per-loop constant...
  const t60 = clamp(3.5 - Math.log2(freq / 82.4) * 0.55, 1.1, 3.8);
  // ...expressed as a per-loop gain: the loop runs `freq` times a second, and
  // -60 dB is a factor of e^-6.91.
  const loss = Math.exp(-6.908 / (t60 * freq));

  // Damping term for the loop filter, whose response is 1 - 2d(1 - cos w):
  // unity at DC, falling smoothly with frequency. Solved for the per-loop gain
  // that gives BRIGHT_DB_PER_SEC at BRIGHT_HZ, which means a string looping
  // more times a second needs less of it.
  const wBright = (2 * Math.PI * BRIGHT_HZ) / fs;
  const perLoop = Math.pow(10, -BRIGHT_DB_PER_SEC / (20 * freq));
  const damp = clamp((1 - perLoop) / (2 * (1 - Math.cos(wBright))), 0.01, MAX_DAMP);
  const mid = 1 - 2 * damp;

  /* --- the loop ---------------------------------------------------------- */
  let read = 0;
  let x1 = 0; // loop filter history
  let x2 = 0;
  let prevIn = 0; // allpass input state
  let prevOut = 0; // allpass output state

  for (let n = 0; n < total; n++) {
    const s = line[read];
    out[n] = s;

    const filtered = (damp * s + mid * x1 + damp * x2) * loss;
    x2 = x1;
    x1 = s;

    const ap = apC * filtered + prevIn - apC * prevOut;
    prevIn = filtered;
    prevOut = ap;

    line[read] = ap;
    read = read + 1 === lineLength ? 0 : read + 1;
  }

  /* --- pick noise and edges ---------------------------------------------- */
  // A couple of milliseconds of the plectrum itself, on top of the string.
  // Short and quiet enough to be a transient rather than a click.
  const pickLen = Math.min(total, Math.round(fs * 0.004));
  let pick = 0;
  for (let n = 0; n < pickLen; n++) {
    pick += (rand() * 2 - 1 - pick) * 0.32;
    out[n] += pick * 0.11 * (1 - n / pickLen) ** 2;
  }
  // A hard start would click; a hard stop would too.
  const fadeIn = Math.min(64, total);
  for (let n = 0; n < fadeIn; n++) out[n] *= n / fadeIn;
  const fadeOut = Math.min(Math.round(fs * 0.05), total);
  for (let n = 0; n < fadeOut; n++) out[total - 1 - n] *= n / fadeOut;

  return out;
}

/** Deterministic PRNG, so the same string plucks the same way every time. */
function makeRandom(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Short vibration for tactile feedback, where the platform supports it. */
export function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
