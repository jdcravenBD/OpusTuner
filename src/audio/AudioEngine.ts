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
/** Absolute level below which an onset is never declared. */
const ONSET_FLOOR = 0.0045;
/**
 * A note is treated as finished once it falls this far below its own sustain
 * level (~-23 dB). Past that point the analysis window holds more room noise
 * and sympathetic ringing from the other strings than the note that was
 * played, which is exactly when a naive tuner starts flapping between notes.
 */
const NOTE_OFF_RATIO = 0.07;
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

    /* --- envelope, onset and note-off ---------------------------------- */
    const env = this.shortRms(ENVELOPE_SAMPLES);
    this.envelope = env;
    this.onsetFlag = false;

    // A pluck is a sharp rise in the short-term level. Requiring a minimum gap
    // since the last onset stops one attack registering as several.
    const gapOk = this.written - this.samplesAtOnset > this.windowSize * 0.4;
    if (env > ONSET_FLOOR && env > this.prevEnvelope * ONSET_RISE_RATIO && gapOk) {
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
      this.sustainRef = Math.max(env, ONSET_FLOOR);
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

    const raw = noteDead
      ? { frequency: 0, clarity: 0, rms: env }
      : detector.detect(scratch, this.clarityThreshold, this.rmsGate);

    // Measured in samples rather than frames so the behaviour is identical on a
    // 60 Hz and a 120 Hz display.
    const settling = this.noteOn && sinceOnset < this.attackBlank + SETTLE_SAMPLES;

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
