/**
 * Reference-tone playback: tap a string to hear the pitch you're aiming for.
 *
 * Uses its own lazily-created AudioContext so it works whether or not the
 * microphone has been started. Additive synthesis with a plucked envelope —
 * musically pleasant, and exactly in tune by construction.
 */

/** Relative amplitudes of harmonics 1..8 — roughly a nylon-string spectrum. */
const HARMONICS = [1, 0.46, 0.28, 0.15, 0.09, 0.055, 0.03, 0.018];

export class ToneEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

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
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Must be called from inside a user gesture at least once on iOS. */
  unlock(): void {
    this.ensure();
  }

  /** Plays a plucked reference tone at `freq` Hz. */
  play(freq: number, durationMs = 2200): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !isFinite(freq) || freq <= 0) return;

    this.stop();

    const now = ctx.currentTime;
    const dur = durationMs / 1000;
    const nyquist = ctx.sampleRate / 2;

    const bus = ctx.createGain();
    bus.gain.value = this.volume * 0.5;

    // Gentle low-pass sweep gives the attack some bite that then mellows,
    // which reads as "plucked" rather than "organ".
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(Math.min(nyquist * 0.9, freq * 12), now);
    filter.frequency.exponentialRampToValueAtTime(Math.min(nyquist * 0.9, freq * 4), now + dur);

    bus.connect(filter);
    filter.connect(this.master);

    HARMONICS.forEach((amp, i) => {
      const partial = freq * (i + 1);
      if (partial >= nyquist * 0.95) return;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = partial;

      const gain = ctx.createGain();
      // Higher partials decay faster, as they do on a real string.
      const decay = dur * (1 - i * 0.07);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(amp, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.15, decay));

      osc.connect(gain);
      gain.connect(bus);
      osc.start(now);
      osc.stop(now + dur + 0.1);

      this.voices.push({ osc, gain });
    });

    this.stopTimer = setTimeout(() => {
      this.voices = [];
      this.stopTimer = null;
    }, durationMs + 200);
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

  stop(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const { osc, gain } of this.voices) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        osc.stop(now + 0.06);
      } catch {
        /* already stopped */
      }
    }
    this.voices = [];
  }

  dispose(): void {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }
}

export const toneEngine = new ToneEngine();

/** Short vibration for tactile feedback, where the platform supports it. */
export function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
