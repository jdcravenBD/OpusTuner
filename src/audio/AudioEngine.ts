/**
 * Microphone capture + analysis pipeline.
 *
 *   getUserMedia -> MediaStreamSource -> AudioWorklet (batching only)
 *                                          |
 *                                     postMessage
 *                                          v
 *                             main-thread ring buffer
 *                                          |
 *                        app frame loop calls analyse()
 *                                          v
 *                            PitchDetector -> PitchTracker
 *
 * The worklet is connected through a muted gain node to the destination.
 * That connection is what guarantees the graph gets pulled every render
 * quantum in every browser; the zero gain guarantees nothing is audible.
 */

import { PitchDetector, PitchTracker, type TrackedPitch } from './pitch';
import { CAPTURE_PROCESSOR_NAME, workletSource } from './workletSource';

export type EngineState = 'idle' | 'starting' | 'running' | 'error';

export type EngineErrorKind =
  | 'permission-denied'
  | 'no-device'
  | 'insecure-context'
  | 'unsupported'
  | 'unknown';

export class EngineError extends Error {
  constructor(
    readonly kind: EngineErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

const RING_SIZE = 16384;
const CHUNK_SIZE = 512;

/**
 * Short window used for the level envelope. ~11 ms at 48 kHz — fast enough to
 * see a pick attack, which the 4096-sample analysis window smears out entirely.
 */
const ENVELOPE_SAMPLES = 512;
/** A pluck must raise the short-term level by at least this factor to count. */
const ONSET_RISE_RATIO = 2.2;
/**
 * How far above the silence gate the level has to be before a rise in it is
 * allowed to count as a pluck (~+5 dB).
 *
 * This was an absolute 0.0045 — -47 dBFS — while the gate sits at -60 by
 * default, and those thirteen decibels were a dead band. Anything inside it
 * was quiet enough never to register as a *note* and loud enough to be
 * detected as a pitch, which is the worst of both: no attack blank, no
 * settling damp, no tracker reset between plucks, and `sustainRef` pinned to
 * the constant instead of the note, which also holds `decayFraction` under the
 * relock threshold in TunerController for the whole life of the note.
 *
 * An unplugged electric guitar lives almost entirely in that band. It was not
 * that the tuner could not hear it; it was that it never understood it had
 * been played, so none of the machinery for holding on to a note ever ran.
 */
export const ONSET_FLOOR_RATIO = 1.8;
/**
 * How far the silence gate is allowed to drop once a note has been acquired
 * (-12 dB).
 *
 * "Is anything there" and "is that still there" are different questions and
 * deserve different answers. Acquiring has to be strict or a room invents
 * notes; following one we already have can afford to be far more permissive,
 * because a string is known to be ringing and every reading still has to clear
 * the clarity test on its way out. One absolute floor for both meant a decay
 * ran into a threshold calibrated for a loud instrument and the reading
 * vanished while the string was plainly still sounding.
 *
 * Only ever in force after a real pluck: with no note on, the gate is exactly
 * what the sensitivity slider says it is.
 */
export const SUSTAIN_GATE_RATIO = 0.25;
/**
 * How far a reading may disagree with the note already on screen before it is
 * refused rather than followed, once the gate has been relaxed.
 *
 * A major sixth, which is the gap between the two things it has to separate.
 * Below it: anything that happens to a note while it rings (a peg turn moves
 * tens of cents, not hundreds) and any change of string — the widest adjacent
 * pair in common use is the fifth at the bottom of DADGAD or drop D, 700
 * cents, so 900 leaves room. Above it: everything this exists to catch, all of
 * which is a whole-number ratio, the nearest being an octave at 1200.
 *
 * Late in a decay the played note and whatever else is ringing are comparable
 * in level, and their sum is honestly periodic at a common sub-multiple. MPM
 * reports that with *high* clarity, because it is true — which is why none of
 * the tracker's guards stop it: the octave vote only recognises 2:1, and the
 * low-clarity disagreement test is looking for the opposite symptom. The
 * reading then clears the tracker's "genuine note change" threshold and snaps,
 * which is a jump of a couple of thousand cents in a single frame.
 *
 * Relaxing the gate buys the tail of a note. It must not also buy a different
 * note: down there we are following something we already have, not deciding
 * what is being played. Refusing the frame lets the tracker coast and, if the
 * disagreement persists, time out and reset — so this can delay a note change
 * but never prevent one.
 */
export const HOLD_DISAGREE_CENTS = 900;

/** True when `hz` is too far from the note being followed to be that note. */
export function tooFarToFollow(followingHz: number, hz: number): boolean {
  return Math.abs(1200 * Math.log2(hz / followingHz)) > HOLD_DISAGREE_CENTS;
}
/**
 * A note is treated as finished once it falls this far below its own sustain
 * level (~-38 dB). Past that point the analysis window holds more room noise
 * and sympathetic ringing from the other strings than the note that was
 * played, which is exactly when a naive tuner starts flapping between notes.
 *
 * This was -23 dB, which at a normal guitar decay is about four seconds — the
 * note was being given up on while it was still perfectly audible and still
 * perfectly detectable. Fifteen dB more is roughly two and a half seconds more
 * of ring. It is still a guard, just a less twitchy one: the string latch and
 * the disagreement test in TunerController are what actually stop the reading
 * wandering onto a neighbour during the tail, and they are untouched.
 */
const NOTE_OFF_RATIO = 0.012;
/**
 * Samples held back *beyond* the analysis window before the first reading of a
 * new note is trusted.
 *
 * Waiting exactly one window is not enough, and that is subtle: at the moment
 * `sinceOnset` reaches `windowSize` the window spans [onset, onset + window],
 * so the pick transient has moved to the leading edge but is still very much
 * inside it. A transient is broadband and has no stable period, and the steep
 * amplitude ramp behind it biases the autocorrelation toward shorter lags —
 * both of which read *sharp*. This pushes the window clear of the attack
 * proper, and past most of the string's own initial sharpening with it.
 *
 * The cost is latency: ~213 ms at 48 kHz from pluck to first new reading. That
 * is not a blank screen — the previous reading stays up — and it buys the thing
 * that actually matters, which is that the first number shown is the right one.
 */
const ATTACK_TAIL_SAMPLES = 6144;
/**
 * How long after the blank the pitch is still measurably falling. A plucked
 * string is genuinely sharp while its amplitude is large — the extra
 * displacement raises the average tension — and the tail of that runs on past
 * the window above. ~256 ms at 48 kHz.
 */
const SETTLE_SAMPLES = 12288;

export interface AudioEngineOptions {
  /** Analysis window in samples. Larger = better low-end, more latency. */
  windowSize?: number;
  /** Linear gain applied to captured samples before analysis. */
  inputGain?: number;
}

export class AudioEngine {
  state: EngineState = 'idle';
  error: EngineError | null = null;
  sampleRate = 0;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private fallback: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;

  private detector: PitchDetector | null = null;
  private tracker = new PitchTracker();

  private ring = new Float32Array(RING_SIZE);
  private writeIndex = 0;
  private written = 0;
  private scratch: Float32Array;

  private windowSize: number;
  inputGain: number;
  private minFreq = 24;
  private maxFreq = 2200;

  /** Clarity floor — raise for a stricter, quieter-room reading. */
  clarityThreshold = 0.55;
  /** RMS floor below which we treat the input as silence. */
  rmsGate = 0.0022;

  private last: TrackedPitch = { frequency: 0, clarity: 0, rms: 0, active: false };
  private peakLevel = 0;

  /* --- note envelope tracking (attack / sustain / decay) ------------------ */
  private envelope = 0;
  private prevEnvelope = 0;
  /** Level just after the attack settles — the reference for note-off. */
  private sustainRef = 0;
  /** `written` at the moment the current note was struck. */
  private samplesAtOnset = 0;
  private noteOn = false;
  private pastAttack = true;
  private onsetFlag = false;
  /** Wall clock past which input is trusted again — see deafenFor(). */
  private deafUntil = 0;

  constructor(opts: AudioEngineOptions = {}) {
    this.windowSize = opts.windowSize ?? 4096;
    this.inputGain = opts.inputGain ?? 1;
    this.scratch = new Float32Array(this.windowSize);
  }

  /* ---------------------------------------------------------------- start -- */

  async start(deviceId?: string): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return;
    this.state = 'starting';
    this.error = null;

    try {
      if (!globalThis.isSecureContext) {
        throw new EngineError(
          'insecure-context',
          'Microphone access needs HTTPS (or localhost).',
        );
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new EngineError('unsupported', 'This browser has no microphone API.');
      }

      // Every one of these processors is poison for a tuner: AGC pumps the
      // level, noise suppression eats sustained tones, echo cancellation
      // introduces its own phase artefacts.
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
        } as MediaTrackConstraints,
        video: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // An exact deviceId that has since vanished (unplugged interface)
        // fails hard — fall back to whatever the system default is.
        if (deviceId && deviceId !== 'default') {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 1,
            } as MediaTrackConstraints,
            video: false,
          });
        } else {
          throw err;
        }
      }
      this.stream = stream;

      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) throw new EngineError('unsupported', 'Web Audio is not available.');

      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.sampleRate = ctx.sampleRate;

      // iOS hands back a suspended context unless resumed inside the gesture
      // that triggered start().
      if (ctx.state === 'suspended') await ctx.resume();

      this.detector = new PitchDetector(
        this.windowSize,
        ctx.sampleRate,
        this.minFreq,
        this.maxFreq,
      );
      this.tracker.reset();
      this.ring.fill(0);
      this.writeIndex = 0;
      this.written = 0;
      this.resetEnvelope();

      this.source = ctx.createMediaStreamSource(stream);
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(ctx.destination);

      if (ctx.audioWorklet) {
        await this.setupWorklet(ctx);
      } else {
        this.setupFallback(ctx);
      }

      this.state = 'running';
    } catch (err) {
      this.stop();
      this.error = toEngineError(err);
      this.state = 'error';
      throw this.error;
    }
  }

  private async setupWorklet(ctx: AudioContext): Promise<void> {
    const blob = new Blob([workletSource], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const node = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkSize: CHUNK_SIZE },
    });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data);

    this.source!.connect(node);
    node.connect(this.sink!);
    this.node = node;
  }

  /** ScriptProcessorNode path for anything predating AudioWorklet. */
  private setupFallback(ctx: AudioContext): void {
    const node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => this.push(e.inputBuffer.getChannelData(0));
    this.source!.connect(node);
    node.connect(this.sink!);
    this.fallback = node;
  }

  /* ----------------------------------------------------------------- stop -- */

  stop(): void {
    try {
      this.node?.port.postMessage('close');
      this.node?.port.close();
    } catch {
      /* already torn down */
    }
    try {
      this.node?.disconnect();
      this.fallback?.disconnect();
      this.source?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* already torn down */
    }
    if (this.fallback) this.fallback.onaudioprocess = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});

    this.node = null;
    this.fallback = null;
    this.source = null;
    this.sink = null;
    this.stream = null;
    this.ctx = null;
    this.detector = null;
    this.tracker.reset();
    this.last = { frequency: 0, clarity: 0, rms: 0, active: false };
    this.peakLevel = 0;
    this.resetEnvelope();
    if (this.state !== 'error') this.state = 'idle';
  }

  private resetEnvelope(): void {
    this.envelope = 0;
    this.prevEnvelope = 0;
    this.sustainRef = 0;
    this.samplesAtOnset = 0;
    this.noteOn = false;
    this.pastAttack = true;
    this.onsetFlag = false;
  }

  /* -------------------------------------------------------------- capture -- */

  private push(samples: Float32Array): void {
    const ring = this.ring;
    const gain = this.inputGain;
    let w = this.writeIndex;
    for (let i = 0; i < samples.length; i++) {
      ring[w] = samples[i] * gain;
      w = (w + 1) & (RING_SIZE - 1);
    }
    this.writeIndex = w;
    this.written += samples.length;
  }

  /* ------------------------------------------------------------- analysis -- */

  /** RMS over the most recent `n` samples — the fast envelope follower. */
  private shortRms(n: number): number {
    const ring = this.ring;
    let sum = 0;
    let r = (this.writeIndex - n + RING_SIZE) & (RING_SIZE - 1);
    for (let i = 0; i < n; i++) {
      const v = ring[r];
      sum += v * v;
      r = (r + 1) & (RING_SIZE - 1);
    }
    return Math.sqrt(sum / n);
  }

  /**
   * Stop listening for a while.
   *
   * The tuner and the reference tone share a room: tap a string to hear the
   * note and the microphone hears it too, so the needle obligingly reports
   * that the app is perfectly in tune with itself. Echo cancellation would
   * deal with it and is exactly what cannot be used here — it is switched off
   * on purpose, along with the noise suppression and the gain control, because
   * all three wreck a tuner.
   *
   * So the engine is told to look away instead. Not muted: the ring buffer
   * goes on filling, the reading on screen stays where it was, and no onset is
   * declared for a sound the app made itself.
   *
   * @param ms how long the sound lasts. A window's worth is added on top,
   *   because its tail is still inside the analysis window after the speaker
   *   has stopped.
   */
  deafenFor(ms: number): void {
    const tail = ((this.windowSize + ATTACK_TAIL_SAMPLES) / (this.sampleRate || 48000)) * 1000;
    this.deafUntil = Math.max(this.deafUntil, performance.now() + ms + tail);
  }

  /** True while the engine is ignoring a sound of the app's own making. */
  get deaf(): boolean {
    return performance.now() < this.deafUntil;
  }

  /**
   * Runs one detection pass over the most recent window. Safe to call at
   * display rate; returns the previous reading unchanged if not enough new
   * audio has arrived yet.
   *
   * Three guards keep the reading honest across the life of a plucked note:
   *
   *  1. **Attack** — for a full analysis window plus a tail after a pluck, the
   *     window still contains the pick transient, which is broadband and has
   *     no stable period. Rather than report the nonsense it produces, the
   *     previous reading is frozen until the transient has scrolled out, and
   *     the tracker then resists the note's residual sharpness while it
   *     settles.
   *  2. **Decay** — once the note falls far enough below its own sustain
   *     level, it is declared over. Otherwise the detector starts tracking
   *     whatever is loudest next: room noise, or another string ringing
   *     sympathetically.
   *  3. **Confidence** — the tracker weights each frame by its clarity, so
   *     the ambiguous frames near the end of a decay barely move the needle.
   */
  analyse(): TrackedPitch {
    const detector = this.detector;
    if (!detector || this.state !== 'running') return this.last;
    if (this.written < this.windowSize) return this.last;
    // Something the app is playing is in the room. Hold everything, the
    // envelope included: a tone's attack would otherwise register as a pluck.
    if (performance.now() < this.deafUntil) return this.last;

    /* --- envelope, onset and note-off ---------------------------------- */
    const env = this.shortRms(ENVELOPE_SAMPLES);
    this.envelope = env;
    this.onsetFlag = false;

    // A pluck is a sharp rise in the short-term level. Requiring a minimum gap
    // since the last onset stops one attack registering as several.
    const gapOk = this.written - this.samplesAtOnset > this.windowSize * 0.4;
    const onsetFloor = this.rmsGate * ONSET_FLOOR_RATIO;
    if (env > onsetFloor && env > this.prevEnvelope * ONSET_RISE_RATIO && gapOk) {
      this.onsetFlag = true;
      this.noteOn = true;
      this.pastAttack = false;
      this.samplesAtOnset = this.written;
      this.tracker.noteAttack();
    }
    this.prevEnvelope = env;

    const sinceOnset = this.written - this.samplesAtOnset;
    const attackClear = !this.noteOn || sinceOnset >= this.attackBlank;

    // First frame with a clean window: this level is the note's true sustain,
    // measured past the attack spike, so it is the right reference for decay.
    if (attackClear && !this.pastAttack) {
      this.pastAttack = true;
      this.sustainRef = Math.max(env, onsetFloor);
    }

    this.updateLevelMeter(env);

    // Guard 1: hold everything steady while the pick transient is still inside
    // the analysis window.
    if (!attackClear) return this.last;

    // Guard 2: the note has decayed into the noise — stop chasing its tail.
    const noteDead = this.noteOn && this.sustainRef > 0 && env < this.sustainRef * NOTE_OFF_RATIO;
    if (noteDead) this.noteOn = false;

    const n = this.windowSize;
    const scratch = this.scratch;
    const ring = this.ring;
    let r = (this.writeIndex - n + RING_SIZE) & (RING_SIZE - 1);
    for (let i = 0; i < n; i++) {
      scratch[i] = ring[r];
      r = (r + 1) & (RING_SIZE - 1);
    }

    // Measured in samples rather than frames so the behaviour is identical on a
    // 60 Hz and a 120 Hz display.
    const settling = this.noteOn && sinceOnset < this.attackBlank + SETTLE_SAMPLES;

    /*
     * Following means there is a note on screen and it has stopped settling.
     *
     * Deliberately not `noteOn`. That clears the moment the note falls far
     * enough below its own sustain, and the slip this exists to catch happens
     * *around* that point — a decayed note is refused on the frame `noteDead`
     * fires, and on the very next frame `noteOn` is false, every guard hung
     * off it is gone, and whatever else is in the room is the loudest periodic
     * thing left. What matters is not whether the engine still calls it a
     * note; it is whether there is a reading on screen to be dragged off.
     *
     * `settling` still matters, though: for the moment after an onset a new
     * string has to be free to arrive from wherever it likes.
     */
    const following = !settling && this.last.frequency > 0;
    const gate = following ? this.rmsGate * SUSTAIN_GATE_RATIO : this.rmsGate;

    let raw = noteDead
      ? { frequency: 0, clarity: 0, rms: env }
      : detector.detect(scratch, this.clarityThreshold, gate);

    // Down in the relaxed range, a reading that is nowhere near the note being
    // followed is a slip onto a sub-multiple, not a change of mind.
    if (following && raw.frequency > 0 && tooFarToFollow(this.last.frequency, raw.frequency)) {
      raw = { frequency: 0, clarity: raw.clarity, rms: raw.rms };
    }

    this.last = this.tracker.update(raw, settling);
    return this.last;
  }

  /** Samples after an onset during which no reading is trusted at all. */
  private get attackBlank(): number {
    return this.windowSize + ATTACK_TAIL_SAMPLES;
  }

  private updateLevelMeter(rms: number): void {
    // Fast-attack / slow-release, on a dB scale so the bar tracks perceived
    // loudness instead of pegging on any real signal.
    const db = 20 * Math.log10(Math.max(rms, 1e-5));
    const level = Math.min(1, Math.max(0, (db + 60) / 60));
    this.peakLevel = level > this.peakLevel ? level : this.peakLevel * 0.9 + level * 0.1;
  }

  /** True while the pick transient is still inside the analysis window. */
  get settling(): boolean {
    return this.noteOn && this.written - this.samplesAtOnset < this.attackBlank;
  }

  /** Set for the single frame on which a new pluck was detected. */
  get onsetDetected(): boolean {
    return this.onsetFlag;
  }

  /** Current short-term level, 0..1-ish. */
  get envelopeLevel(): number {
    return this.envelope;
  }

  /**
   * Current level as a fraction of the note's sustain level. Below ~0.5 the
   * note being played is well into its decay, which is how we tell a genuine
   * string change (level holds up or rises) from a note fading out underneath
   * another string that is still ringing (level falling).
   */
  get decayFraction(): number {
    if (!this.noteOn || this.sustainRef <= 0) return 1;
    return this.envelope / this.sustainRef;
  }

  /** Smoothed input level, 0..1. Not currently surfaced in the UI. */
  get level(): number {
    return this.peakLevel;
  }

  get reading(): TrackedPitch {
    return this.last;
  }

  /** Drops smoothing state — call when the target note changes. */
  resetTracking(): void {
    this.tracker.reset();
  }

  /**
   * Restricts detection to a plausible pitch range for the selected tuning.
   * Stored so it survives a restart of the capture graph.
   */
  setPitchRange(minFreq: number, maxFreq: number): void {
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
    this.detector?.setRange(minFreq, maxFreq);
  }
}

function toEngineError(err: unknown): EngineError {
  if (err instanceof EngineError) return err;
  const e = err as DOMException | undefined;
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new EngineError(
        'permission-denied',
        'Microphone permission was denied. Allow it in your browser settings and try again.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new EngineError('no-device', 'No microphone was found on this device.');
    case 'NotReadableError':
      return new EngineError(
        'unknown',
        'The microphone is in use by another app. Close it and try again.',
      );
    default:
      return new EngineError('unknown', e?.message || 'Could not start the microphone.');
  }
}

/** Input devices for the settings picker. Labels require a prior permission grant. */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}
