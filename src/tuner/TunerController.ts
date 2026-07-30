/**
 * The tuner's runtime core.
 *
 * Deliberately outside React. The needle, cent readout and gauge update every
 * animation frame; routing that through component state would mean ~60
 * reconciliations a second for values that only ever touch a handful of DOM
 * nodes. Instead this class owns a single rAF loop, mutates one `TunerFrame`
 * object in place, and lets subscribers write to the DOM directly.
 *
 * Things that genuinely change React's tree — which string is selected, which
 * strings have landed in tune — are emitted as discrete events instead.
 */

import { AudioEngine, EngineError } from '../audio/AudioEngine';
import { centsBetween, freqToMidi, midiToFreq } from '../music/notes';

export interface TunerFrame {
  /** A pitched signal is currently present. */
  hasSignal: boolean;
  /** Smoothed detected pitch in Hz (0 when silent). */
  frequency: number;
  /** Signed cents from the active target. Positive = sharp. */
  cents: number;
  /** Index into the active tuning's strings, or -1 in chromatic mode. */
  targetIndex: number;
  /** MIDI note being tuned toward. */
  targetMidi: number;
  targetFreq: number;
  inTune: boolean;
  clarity: number;
  /** Smoothed input level, 0..1. Not currently surfaced in the UI. */
  level: number;
}

export type TunerEvent =
  | { type: 'target' }
  | { type: 'tuned'; index: number }
  | { type: 'untuned'; index: number }
  | { type: 'all-tuned' }
  | { type: 'status' };

type FrameListener = (frame: TunerFrame) => void;
type EventListener = (event: TunerEvent) => void;

/** Frames a note must stay inside the tolerance window before it counts. */
const TUNED_HOLD_FRAMES = 32;
/** Frames outside ±25¢ before a previously-tuned string is marked dirty again. */
const UNTUNED_HOLD_FRAMES = 40;
/**
 * How far the pitch must sit from the locked string before we even consider
 * that we might be hearing something else.
 */
const DISAGREE_CENTS = 150;
/**
 * ...and how close it must sit to a *different* string in the same tuning.
 * Both conditions together are what separates "another string has taken over"
 * from "the string they are tuning is simply very flat" — the second case must
 * stay locked, because tracking a badly-out string is the entire job.
 */
const ON_STRING_CENTS = 60;
const RELOCK_CLARITY = 0.9;
const RELOCK_FRAMES = 16;

/** resolveAutoIndex: the struck note is finished. */
const AUTO_OVER = -1;
/** resolveAutoIndex: undecided — freeze the display rather than show a guess. */
const AUTO_HOLD = -2;
/**
 * Above this fraction of the note's sustain level, a disagreement means the
 * player moved to another string and we should follow. Below it the note is
 * fading and the new pitch is almost certainly a neighbour ringing
 * sympathetically — then the right answer is "the note is over", not "switch".
 */
const LIVE_LEVEL_FRACTION = 0.45;

export class TunerController {
  readonly engine = new AudioEngine();

  readonly frame: TunerFrame = {
    hasSignal: false,
    frequency: 0,
    cents: 0,
    targetIndex: -1,
    targetMidi: 0,
    targetFreq: 0,
    inTune: false,
    clarity: 0,
    level: 0,
  };

  /** MIDI targets, lowest string first, capo already applied. */
  targets: number[] = [];
  chromatic = false;
  auto = true;
  autoAdvance = true;
  tolerance = 5;

  private _a4 = 440;

  get a4(): number {
    return this._a4;
  }

  set a4(value: number) {
    if (value === this._a4) return;
    this._a4 = value;
    this.applyPitchRange();
  }

  /** Which strings have been successfully tuned this session. */
  tuned: boolean[] = [];
  /** Active string in manual mode; also the auto-detected string in auto mode. */
  selectedIndex = 0;

  private frameListeners = new Set<FrameListener>();
  private eventListeners = new Set<EventListener>();
  private rafId = 0;
  private running = false;

  private inTuneFrames = 0;
  private outOfTuneFrames = 0;
  private lastEmittedIndex = -2;

  /** String auto-detect latches onto for the duration of one note. -1 = unset. */
  private lockedIndex = -1;
  private needsRelock = true;
  private disagreeFrames = 0;
  /** The struck note has faded; wait for a new pluck before showing anything. */
  private noteOver = false;

  /* ------------------------------------------------------------ lifecycle -- */

  async startMic(deviceId?: string): Promise<void> {
    await this.engine.start(deviceId);
    this.emit({ type: 'status' });
  }

  stopMic(): void {
    this.engine.stop();
    this.resetFrame();
    this.emit({ type: 'status' });
  }

  get micState() {
    return this.engine.state;
  }

  get micError(): EngineError | null {
    return this.engine.error;
  }

  startLoop(): void {
    if (this.running) return;
    this.running = true;
    const step = () => {
      if (!this.running) return;
      this.tick();
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  stopLoop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  dispose(): void {
    this.stopLoop();
    this.engine.stop();
    this.frameListeners.clear();
    this.eventListeners.clear();
  }

  /* ------------------------------------------------------------- targets -- */

  /** Replaces the target set. Resets tuned flags when the shape changes. */
  setTargets(targets: number[], chromatic: boolean, preserveTuned = false): void {
    const sameShape =
      this.chromatic === chromatic &&
      this.targets.length === targets.length &&
      this.targets.every((t, i) => t === targets[i]);

    this.targets = targets;
    this.chromatic = chromatic;
    this.applyPitchRange();

    if (!sameShape || this.tuned.length !== targets.length) {
      if (!preserveTuned) this.tuned = new Array(targets.length).fill(false);
      else this.tuned = targets.map((_, i) => this.tuned[i] ?? false);
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, targets.length - 1));
      this.inTuneFrames = 0;
      this.outOfTuneFrames = 0;
      this.releaseLock();
      this.engine.resetTracking();
      this.emit({ type: 'target' });
    }
  }

  selectString(index: number): void {
    if (index < 0 || index >= this.targets.length) return;
    if (this.selectedIndex === index) return;
    this.selectedIndex = index;
    this.inTuneFrames = 0;
    this.outOfTuneFrames = 0;
    this.releaseLock();
    this.engine.resetTracking();
    this.emit({ type: 'target' });
  }

  /** Clears every green check so the player can run through the set again. */
  resetTuned(): void {
    if (!this.tuned.some(Boolean)) return;
    this.tuned = this.tuned.map(() => false);
    this.inTuneFrames = 0;
    this.emit({ type: 'target' });
  }

  /* ---------------------------------------------------------------- loop -- */

  private tick(): void {
    const f = this.frame;
    const reading = this.engine.analyse();

    if (this.engine.onsetDetected) {
      // A fresh pluck: the next clean frame re-chooses the string.
      this.needsRelock = true;
      this.disagreeFrames = 0;
      this.noteOver = false;
    }

    f.level = this.engine.level;

    // The pick transient is still inside the analysis window. Freeze the whole
    // frame — note, cents and target alike — so the attack cannot throw the
    // display before there is anything trustworthy to show.
    if (this.engine.settling) {
      this.notifyFrame();
      return;
    }

    f.clarity = reading.clarity;

    // The struck note faded out while something else kept ringing. Stay quiet
    // until the next pluck rather than reporting a string nobody played.
    if (this.noteOver && !this.chromatic && this.auto) {
      f.hasSignal = false;
      f.frequency = 0;
      f.inTune = false;
      this.inTuneFrames = 0;
      this.outOfTuneFrames = 0;
      if (reading.frequency <= 0) {
        this.releaseLock();
        this.noteOver = false;
      }
      this.notifyFrame();
      return;
    }

    if (!reading.active || reading.frequency <= 0) {
      f.hasSignal = false;
      f.frequency = 0;
      f.inTune = false;
      this.inTuneFrames = 0;
      this.outOfTuneFrames = 0;
      if (reading.frequency <= 0) this.releaseLock();
      // Target and cents are intentionally left at their last values so the
      // needle rests where the note died instead of snapping to centre.
      this.notifyFrame();
      return;
    }

    f.hasSignal = true;
    f.frequency = reading.frequency;

    let index = -1;
    let targetMidi: number;

    if (this.chromatic || this.targets.length === 0) {
      targetMidi = Math.round(freqToMidi(reading.frequency, this.a4));
    } else if (this.auto) {
      index = this.resolveAutoIndex(reading.frequency, reading.clarity);
      if (index === AUTO_HOLD) {
        this.notifyFrame();
        return;
      }
      if (index === AUTO_OVER) {
        this.noteOver = true;
        f.hasSignal = false;
        f.frequency = 0;
        f.inTune = false;
        this.inTuneFrames = 0;
        this.outOfTuneFrames = 0;
        this.notifyFrame();
        return;
      }
      targetMidi = this.targets[index];
    } else {
      index = Math.min(this.selectedIndex, this.targets.length - 1);
      targetMidi = this.targets[index];
    }

    const targetFreq = midiToFreq(targetMidi, this.a4);
    const cents = centsBetween(reading.frequency, targetFreq);

    f.targetIndex = index;
    f.targetMidi = targetMidi;
    f.targetFreq = targetFreq;
    f.cents = cents;
    f.inTune = Math.abs(cents) <= this.tolerance;

    if (index !== -1 && index !== this.selectedIndex && this.auto) {
      this.selectedIndex = index;
      this.inTuneFrames = 0;
      this.outOfTuneFrames = 0;
    }

    if (index !== this.lastEmittedIndex) {
      this.lastEmittedIndex = index;
      this.emit({ type: 'target' });
    }

    this.trackTunedState(index, cents);
    this.notifyFrame();
  }

  /**
   * Which string auto-detect should show.
   *
   * The choice is made once, on the first clean frame after a pluck, and then
   * held for the life of that note. Re-deciding every frame is what makes a
   * tuner wander during a decay: as the played string fades, a neighbour
   * ringing sympathetically can genuinely become the nearest pitch, and the
   * display hops to it just as the player is making their final adjustment.
   * Locking also means a string tuned more than a semitone flat keeps showing
   * the string you are actually turning, rather than snapping to its neighbour.
   */
  private resolveAutoIndex(freq: number, clarity: number): number {
    const n = this.targets.length;
    if (this.lockedIndex < 0 || this.lockedIndex >= n) this.needsRelock = true;

    if (this.needsRelock) {
      this.lockedIndex = this.pickNearestString(freq);
      this.needsRelock = false;
      this.disagreeFrames = 0;
      return this.lockedIndex;
    }

    const offBy = Math.abs(
      centsBetween(freq, midiToFreq(this.targets[this.lockedIndex], this.a4)),
    );
    const rival = this.pickNearestString(freq);
    const rivalCents = Math.abs(centsBetween(freq, midiToFreq(this.targets[rival], this.a4)));

    // Purely geometric: is the pitch we are hearing sitting on a different
    // string of this tuning? Confidence deliberately plays no part here — a
    // clarity term would flicker across its threshold and keep resetting the
    // counter, which leaves the bad reading on screen indefinitely. Clarity
    // gates the decision below, not whether to trust what we are seeing.
    const hijacked =
      rival !== this.lockedIndex && offBy > DISAGREE_CENTS && rivalCents < ON_STRING_CENTS;

    if (!hijacked) {
      this.disagreeFrames = 0;
      return this.lockedIndex;
    }

    // Undecided: hold the display steady instead of letting it show a reading
    // we are about to reject.
    if (++this.disagreeFrames < RELOCK_FRAMES) return AUTO_HOLD;
    this.disagreeFrames = 0;

    if (this.engine.decayFraction >= LIVE_LEVEL_FRACTION && clarity > RELOCK_CLARITY) {
      // Level is holding up: they really did move to another string.
      this.lockedIndex = rival;
      return this.lockedIndex;
    }
    // The struck note has faded and another string is ringing underneath.
    // Report it finished rather than jumping onto a string nobody played.
    return AUTO_OVER;
  }

  /**
   * Constrains detection to the range the selected tuning can actually
   * produce. Six semitones of slack below the lowest string is enough for even
   * a badly slack new string, while still ruling out the common subharmonics
   * that appear when two strings ring together.
   */
  private applyPitchRange(): void {
    if (this.chromatic || this.targets.length === 0) {
      // Chromatic has to accept anything: 27 Hz clears a 5-string bass B0.
      this.engine.setPitchRange(27, 2200);
      return;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of this.targets) {
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
    this.engine.setPitchRange(
      Math.max(24, midiToFreq(lo - 6, this._a4)),
      Math.min(4000, midiToFreq(hi + 7, this._a4)),
    );
  }

  private releaseLock(): void {
    this.lockedIndex = -1;
    this.needsRelock = true;
    this.disagreeFrames = 0;
    this.noteOver = false;
  }

  /** Nearest target by absolute cents. */
  private pickNearestString(freq: number): number {
    let best = 0;
    let bestCents = Infinity;
    for (let i = 0; i < this.targets.length; i++) {
      const d = Math.abs(centsBetween(freq, midiToFreq(this.targets[i], this.a4)));
      if (d < bestCents) {
        bestCents = d;
        best = i;
      }
    }
    return best;
  }

  private trackTunedState(index: number, cents: number): void {
    if (index < 0) return;
    const abs = Math.abs(cents);

    if (abs <= this.tolerance) {
      this.outOfTuneFrames = 0;
      this.inTuneFrames++;
      if (this.inTuneFrames === TUNED_HOLD_FRAMES && !this.tuned[index]) {
        this.tuned[index] = true;
        this.emit({ type: 'tuned', index });
        if (this.tuned.every(Boolean)) this.emit({ type: 'all-tuned' });
        else if (this.autoAdvance && !this.auto) this.advanceToNextUntuned(index);
      }
    } else {
      this.inTuneFrames = 0;
      if (abs > 25 && this.tuned[index]) {
        this.outOfTuneFrames++;
        if (this.outOfTuneFrames === UNTUNED_HOLD_FRAMES) {
          this.tuned[index] = false;
          this.emit({ type: 'untuned', index });
        }
      } else {
        this.outOfTuneFrames = 0;
      }
    }
  }

  private advanceToNextUntuned(from: number): void {
    const n = this.targets.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + step) % n;
      if (!this.tuned[i]) {
        this.selectString(i);
        return;
      }
    }
  }

  private resetFrame(): void {
    const f = this.frame;
    f.hasSignal = false;
    f.frequency = 0;
    f.cents = 0;
    f.inTune = false;
    f.clarity = 0;
    f.level = 0;
    this.inTuneFrames = 0;
    this.outOfTuneFrames = 0;
    this.notifyFrame();
  }

  /* ---------------------------------------------------------- subscribers -- */

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private notifyFrame(): void {
    for (const l of this.frameListeners) l(this.frame);
  }

  private emit(event: TunerEvent): void {
    for (const l of this.eventListeners) l(event);
  }
}

export const tuner = new TunerController();
