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
   * acoustic guitar is the box, which is mostly two resonances (the air cavity
   * around 100 Hz and the top plate an octave above) sitting on a gentle tilt
   * away from the very top end.
   */
  private buildBody(ctx: AudioContext): GainNode {
    const input = ctx.createGain();
    input.gain.value = 1;

    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 65;
    rumble.Q.value = 0.7;

    const air = ctx.createBiquadFilter();
    air.type = 'peaking';
    air.frequency.value = 104;
    air.Q.value = 1.6;
    air.gain.value = 4.5;

    const plate = ctx.createBiquadFilter();
    plate.type = 'peaking';
    plate.frequency.value = 216;
    plate.Q.value = 1.9;
    plate.gain.value = 3;

    const tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 3600;
    tilt.gain.value = -5;

    input.connect(rumble);
    rumble.connect(air);
    air.connect(plate);
    plate.connect(tilt);
    tilt.connect(ctx.destination);
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
    gain.gain.value = this.volume * 0.62;

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

/**
 * Synthesises one plucked string.
 *
 * The waveguide loop must delay by exactly `sampleRate / freq` samples or the
 * note is out of tune, which for a tuner's own reference tone would be absurd.
 * An integer delay line alone is up to fifteen cents out at guitar pitches, so
 * the loop length is made of three parts: the integer line, the exactly
 * half-sample delay of the averaging filter, and an allpass section for the
 * remaining fraction. The allpass's phase delay is only exact at DC, but a
 * guitar's fundamental sits well under a thousandth of the sample rate, where
 * the error is far beyond hearing — `npm test` renders this and measures it.
 *
 * Exported separately from the engine so that test can run it with no
 * AudioContext in sight.
 */
export function renderPluck(fs: number, freq: number, seconds: number): Float32Array | null {
  const period = fs / freq;
  if (!isFinite(period) || period <= 4) return null;

  // The averaging filter contributes exactly 0.5 samples at every frequency.
  const lineLength = Math.floor(period - 0.5);
  const fraction = period - lineLength - 0.5;
  // Allpass coefficient for a delay of `fraction` samples.
  const apC = (1 - fraction) / (1 + fraction);

  const total = Math.max(1, Math.ceil(seconds * fs));
  const out = new Float32Array(total);

  /* --- excitation ------------------------------------------------------- */
  const line = new Float32Array(lineLength);
  const rand = makeRandom(Math.round(freq * 1000));
  // Low-passed noise: how hard the pick is. Pure white is a plectrum made of
  // glass, and it is the single thing that makes naive Karplus-Strong sound
  // synthetic.
  let lp = 0;
  for (let i = 0; i < lineLength; i++) {
    lp += (rand() * 2 - 1 - lp) * 0.42;
    line[i] = lp;
  }
  // Pluck position. Displacing the string a fifth of its length from the bridge
  // puts a notch on every fifth harmonic — the comb that stops a waveguide
  // sounding like a filtered buzz.
  const pluckAt = Math.max(1, Math.round(lineLength * 0.19));
  const shaped = new Float32Array(lineLength);
  for (let i = 0; i < lineLength; i++) {
    shaped[i] = line[i] - line[(i + pluckAt) % lineLength];
  }
  let peak = 0;
  for (let i = 0; i < lineLength; i++) peak = Math.max(peak, Math.abs(shaped[i]));
  const norm = peak > 1e-6 ? 0.72 / peak : 0;
  for (let i = 0; i < lineLength; i++) line[i] = shaped[i] * norm;

  /* --- decay ------------------------------------------------------------- */
  // Bass strings ring longer than treble ones, so the loss is set from a wanted
  // decay time rather than being a fixed per-loop constant.
  const t60 = clamp(3.5 - Math.log2(freq / 82.4) * 0.55, 1.1, 3.8);
  // ...expressed as a per-loop gain: the loop runs `freq` times a second, and
  // -60 dB is a factor of e^-6.91.
  const loss = Math.exp(-6.908 / (t60 * freq));

  /* --- the loop ---------------------------------------------------------- */
  let read = 0;
  let prevSample = 0; // averaging filter state
  let prevIn = 0; // allpass input state
  let prevOut = 0; // allpass output state

  for (let n = 0; n < total; n++) {
    const s = line[read];
    out[n] = s;

    // Two-point average: linear phase, so it damps the harmonics — high ones
    // hardest, which is the tone darkening as the note rings — without
    // disturbing the tuning.
    const avg = 0.5 * (s + prevSample) * loss;
    prevSample = s;

    const ap = apC * avg + prevIn - apC * prevOut;
    prevIn = avg;
    prevOut = ap;

    line[read] = ap;
    read = read + 1 === lineLength ? 0 : read + 1;
  }

  /* --- pick noise and edges ---------------------------------------------- */
  // A few milliseconds of the plectrum itself, on top of the string. Short
  // enough to be a transient rather than a pitch.
  const pickLen = Math.min(total, Math.round(fs * 0.006));
  let pick = 0;
  for (let n = 0; n < pickLen; n++) {
    pick += (rand() * 2 - 1 - pick) * 0.55;
    out[n] += pick * 0.2 * (1 - n / pickLen) ** 2;
  }
  // A hard start would click; a hard stop would too.
  const fadeIn = Math.min(48, total);
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
