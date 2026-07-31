/**
 * Pitch detection via the McLeod Pitch Method (MPM).
 *
 * MPM computes a Normalised Square Difference Function (NSDF) and picks the
 * first key maximum above `k` times the global maximum. That "first peak wins"
 * rule is what makes it resistant to the octave errors plain autocorrelation
 * suffers from on harmonically rich sources like a plucked low E.
 *
 * The autocorrelation half of the NSDF is computed with an FFT (O(n log n))
 * so a 4096-sample window costs well under a millisecond.
 */

import { FFT } from './fft';

export interface PitchResult {
  /** Detected fundamental in Hz, or 0 when nothing usable was found. */
  frequency: number;
  /** NSDF peak height, 0..1. Above ~0.9 is a clean, confidently pitched tone. */
  clarity: number;
  /** RMS level of the analysis window, 0..1. */
  rms: number;
}

export class PitchDetector {
  readonly windowSize: number;
  readonly sampleRate: number;

  private readonly fft: FFT;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly nsdf: Float32Array;
  private readonly work: Float32Array;
  private readonly peaks: Int32Array;

  private minTau = 2;
  private maxTau = 0;

  /**
   * @param windowSize analysis window in samples (power of two)
   * @param sampleRate audio context sample rate
   * @param minFreq    lowest detectable pitch — 24 Hz clears a 5-string bass B0 (30.87 Hz)
   * @param maxFreq    highest detectable pitch — 2200 Hz clears violin E5 harmonics
   */
  constructor(windowSize: number, sampleRate: number, minFreq = 24, maxFreq = 2200) {
    this.windowSize = windowSize;
    this.sampleRate = sampleRate;

    const fftSize = windowSize * 2; // zero-padded for *linear* (not circular) autocorrelation
    this.fft = new FFT(fftSize);
    this.re = new Float32Array(fftSize);
    this.im = new Float32Array(fftSize);
    this.nsdf = new Float32Array(windowSize);
    this.work = new Float32Array(windowSize);
    this.peaks = new Int32Array(256);

    this.setRange(minFreq, maxFreq);
  }

  /**
   * Narrows the search to the pitches actually worth considering.
   *
   * This matters more than it looks. When two strings ring together their
   * combined waveform is genuinely periodic at their common subharmonic — a
   * perfect fourth apart, E2 and A2 repeat at ~27.5 Hz — and MPM will report
   * that with high confidence because it is the honest answer. Telling the
   * detector that nothing below the lowest string is a plausible pitch makes
   * it pick the next candidate up instead of a note the instrument can't play.
   */
  setRange(minFreq: number, maxFreq: number): void {
    this.minTau = Math.max(2, Math.floor(this.sampleRate / maxFreq));
    this.maxTau = Math.min(this.windowSize - 2, Math.ceil(this.sampleRate / minFreq));
  }

  detect(input: Float32Array, clarityThreshold = 0.55, rmsGate = 0.0022): PitchResult {
    const n = this.windowSize;
    const x = this.work;

    // --- de-mean --------------------------------------------------------
    // Removes DC and most sub-audio rumble, both of which wreck the NSDF's
    // normalisation term at large lags.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += input[i];
    mean /= n;

    let sumSquares = 0;
    for (let i = 0; i < n; i++) {
      const v = input[i] - mean;
      x[i] = v;
      sumSquares += v * v;
    }

    const rms = Math.sqrt(sumSquares / n);
    if (rms < rmsGate) return { frequency: 0, clarity: 0, rms };

    // --- autocorrelation r[tau] via FFT ---------------------------------
    const fftSize = this.re.length;
    this.re.set(x.subarray(0, n));
    this.re.fill(0, n);
    this.im.fill(0);

    this.fft.transform(this.re, this.im);
    for (let i = 0; i < fftSize; i++) {
      const rr = this.re[i];
      const ii = this.im[i];
      this.re[i] = rr * rr + ii * ii; // power spectrum
      this.im[i] = 0;
    }
    this.fft.inverse(this.re, this.im);

    const invN = 1 / fftSize;

    // --- NSDF: n'(tau) = 2 * r(tau) / m(tau) ----------------------------
    // m(tau) is maintained incrementally: dropping one sample from each end
    // of the overlap as tau grows.
    const nsdf = this.nsdf;
    let m = 2 * sumSquares;
    const maxTau = Math.min(this.maxTau, n - 1);

    for (let tau = 0; tau <= maxTau; tau++) {
      if (tau > 0) {
        const a = x[tau - 1];
        const b = x[n - tau];
        m -= a * a + b * b;
      }
      nsdf[tau] = m > 1e-12 ? (2 * (this.re[tau] * invN)) / m : 0;
    }

    // --- key maxima ------------------------------------------------------
    const peakCount = this.findKeyMaxima(nsdf, maxTau);
    if (peakCount === 0) return { frequency: 0, clarity: 0, rms };

    let highest = 0;
    for (let i = 0; i < peakCount; i++) {
      const v = nsdf[this.peaks[i]];
      if (v > highest) highest = v;
    }
    if (highest < clarityThreshold) return { frequency: 0, clarity: highest, rms };

    // MPM's cutoff: take the *earliest* peak that is nearly as tall as the
    // tallest one. k=0.9 is McLeod's recommended value.
    const cutoff = 0.9 * highest;
    let chosen = -1;
    for (let i = 0; i < peakCount; i++) {
      const p = this.peaks[i];
      if (p < this.minTau) continue; // above maxFreq — not a musical pitch here
      if (nsdf[p] >= cutoff) {
        chosen = p;
        break;
      }
    }
    if (chosen < 1) return { frequency: 0, clarity: highest, rms };

    // --- parabolic interpolation for sub-sample lag ----------------------
    const y1 = nsdf[chosen - 1];
    const y2 = nsdf[chosen];
    const y3 = nsdf[chosen + 1];
    const a = (y1 + y3 - 2 * y2) / 2;
    const b = (y3 - y1) / 2;

    let tau = chosen;
    let clarity = y2;
    if (a < 0) {
      const delta = -b / (2 * a);
      if (delta > -1 && delta < 1) {
        tau = chosen + delta;
        clarity = y2 - (b * b) / (4 * a);
      }
    }

    if (tau <= 0) return { frequency: 0, clarity: 0, rms };

    const frequency = this.sampleRate / tau;
    if (frequency < 20 || frequency > 5000) return { frequency: 0, clarity, rms };

    return { frequency, clarity: Math.min(1, clarity), rms };
  }

  /**
   * Collects the tallest local maximum within each positive lobe of the NSDF.
   * Returns how many were written into `this.peaks`.
   */
  private findKeyMaxima(nsdf: Float32Array, maxTau: number): number {
    const peaks = this.peaks;
    let count = 0;
    let pos = 0;

    // Skip the initial descent from n'(0)=1 down through the first zero
    // crossing — that lobe is the trivial zero-lag peak, not a period. This
    // must start at lag 0: starting at minTau can land mid-lobe on a high
    // note and skip straight past its real peak, costing an octave.
    while (pos < maxTau && nsdf[pos] > 0) pos++;
    while (pos < maxTau && nsdf[pos] <= 0) pos++;
    if (pos === 0) pos = 1;

    let curMax = 0;
    while (pos < maxTau) {
      if (nsdf[pos] > nsdf[pos - 1] && nsdf[pos] >= nsdf[pos + 1]) {
        if (curMax === 0 || nsdf[pos] > nsdf[curMax]) curMax = pos;
      }
      pos++;
      if (pos < maxTau && nsdf[pos] <= 0) {
        if (curMax > 0 && count < peaks.length) peaks[count++] = curMax;
        curMax = 0;
        while (pos < maxTau && nsdf[pos] <= 0) pos++;
      }
    }
    if (curMax > 0 && count < peaks.length) peaks[count++] = curMax;

    return count;
  }
}

/* -------------------------------------------------------------------------- */
/*  Temporal stabiliser                                                        */
/* -------------------------------------------------------------------------- */

export interface TrackedPitch {
  /** Smoothed frequency in Hz, or 0 while no note is being held. */
  frequency: number;
  clarity: number;
  rms: number;
  /** True while a note is actively detected (as opposed to coasting on hold). */
  active: boolean;
}

/**
 * Smooths raw frame-by-frame detections into something a needle can follow.
 *
 * Works in the log-frequency (cents) domain so smoothing is musically uniform,
 * uses a median to reject single-frame outliers, and applies an adaptive
 * exponential glide that snaps quickly on a new note but crawls once settled.
 */
/**
 * How far a note may run sharp purely because it was just plucked. A hard pick
 * stretches the string, and the extra tension genuinely raises the pitch until
 * the amplitude comes down; the detector's own envelope bias pushes the same
 * way. Rises smaller than this during the settling phase are treated as that
 * artefact, larger ones as the player actually turning the peg.
 */
const ATTACK_SHARP_CENTS = 35;
/**
 * How much more slowly the needle rises than it falls while a note settles.
 *
 * Deliberately a lean rather than a lock. Damping harder would flatten the
 * artefact completely, but it would also mean a player who turns a peg and
 * re-plucks every half second never lets a settling phase finish, and the
 * needle would sit permanently flat of the truth. At this weight it still
 * covers three quarters of a genuine change within one settling phase.
 */
const SETTLE_RISE_FACTOR = 0.3;

export class PitchTracker {
  private history: number[] = [];
  private smoothCents = 0;
  private hasValue = false;
  private silentFrames = 0;
  private octaveVotes = 0;
  private pendingCents = 0;

  /** Frames of silence tolerated before the reading is dropped. */
  private readonly holdFrames: number;
  private readonly medianSize = 5;

  constructor(holdFrames = 18) {
    this.holdFrames = holdFrames;
  }

  reset(): void {
    this.history.length = 0;
    this.hasValue = false;
    this.silentFrames = 0;
    this.octaveVotes = 0;
  }

  /**
   * A fresh pluck of (probably) the same note.
   *
   * The median window is dropped because its contents belong to the previous
   * note, but the smoothed value is deliberately kept. That is the whole point:
   * a re-pluck resumes from where the needle already sits instead of snapping
   * to the first post-attack reading, which is the sharpest one the note will
   * ever produce. A genuine change of string is still caught downstream by the
   * large-interval check in `update`, which snaps as before.
   */
  noteAttack(): void {
    this.history.length = 0;
    this.silentFrames = 0;
    this.octaveVotes = 0;
  }

  /**
   * @param settling true while the struck note is still falling from its
   *   attack sharpening — see `ATTACK_SHARP_CENTS`.
   */
  update(result: PitchResult, settling = false): TrackedPitch {
    if (result.frequency <= 0) {
      this.silentFrames++;
      if (this.silentFrames > this.holdFrames) {
        this.reset();
        return { frequency: 0, clarity: result.clarity, rms: result.rms, active: false };
      }
      return {
        frequency: this.hasValue ? centsToFreq(this.smoothCents) : 0,
        clarity: result.clarity,
        rms: result.rms,
        active: false,
      };
    }

    this.silentFrames = 0;
    const cents = freqToCents(result.frequency);

    // Octave-jump guard: a single frame landing exactly 1200 cents away is far
    // more likely to be a detector slip than the player actually jumping an
    // octave, so require a few consecutive confirmations before following it.
    if (this.hasValue) {
      const delta = cents - this.smoothCents;
      const nearOctave = Math.abs(Math.abs(delta) - 1200) < 45;
      if (nearOctave) {
        if (Math.abs(cents - this.pendingCents) < 60) this.octaveVotes++;
        else this.octaveVotes = 1;
        this.pendingCents = cents;
        if (this.octaveVotes < 3) {
          return {
            frequency: centsToFreq(this.smoothCents),
            clarity: result.clarity,
            rms: result.rms,
            active: true,
          };
        }
      } else {
        this.octaveVotes = 0;
      }
    }

    // Late in a decay the detector starts offering alternatives — a neighbour
    // string ringing sympathetically, or noise that happens to correlate. Those
    // frames arrive with visibly lower clarity, so a reading that both
    // disagrees with the established note *and* is poorly resolved is dropped
    // rather than allowed to drag the needle off the note being played.
    if (this.hasValue && result.clarity < 0.82 && Math.abs(cents - this.smoothCents) > 55) {
      return {
        frequency: centsToFreq(this.smoothCents),
        clarity: result.clarity,
        rms: result.rms,
        active: true,
      };
    }

    // A genuine note change resets the median window so the display doesn't
    // drag a stale value across.
    if (this.hasValue && Math.abs(cents - this.smoothCents) > 180) {
      this.history.length = 0;
      this.hasValue = false;
    }

    this.history.push(cents);
    if (this.history.length > this.medianSize) this.history.shift();

    const med = median(this.history);

    if (!this.hasValue) {
      this.smoothCents = med;
      this.hasValue = true;
    } else {
      const rise = med - this.smoothCents;
      const dist = Math.abs(rise);
      // Far away -> chase hard (snappy note changes). Close -> creep (rock-steady needle).
      // Scaled by confidence, so a marginal frame nudges the needle instead of
      // yanking it: this is what stops the reading getting jittery as a note
      // fades and every frame becomes a little less certain than the last.
      const confidence = clamp((result.clarity - 0.6) / 0.32, 0.18, 1);
      let alpha = clamp((0.09 + dist / 90) * confidence, 0.03, 0.6);

      // Just after a pluck the pitch only ever moves one way — down, off the
      // attack sharpening and onto the note the string is actually tuned to.
      // Damping the upward direction (and only by a plausible amount, and only
      // during this phase) lets the needle ride the settling curve instead of
      // being thrown sharp by its start.
      if (settling && rise > 0 && rise < ATTACK_SHARP_CENTS) alpha *= SETTLE_RISE_FACTOR;

      this.smoothCents += rise * alpha;
    }

    return {
      frequency: centsToFreq(this.smoothCents),
      clarity: result.clarity,
      rms: result.rms,
      active: true,
    };
  }
}

function freqToCents(f: number): number {
  return 1200 * Math.log2(f);
}

function centsToFreq(c: number): number {
  return Math.pow(2, c / 1200);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
