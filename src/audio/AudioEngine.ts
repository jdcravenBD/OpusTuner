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

/* --- the adaptive noise floor --------------------------------------------- */

/*
 * Where the silence gate comes from.
 *
 * It used to come from a slider. One number, set by hand, deciding what counts
 * as silence in a room the app has never heard — and it had to be asked for,
 * because the level an instrument arrives at spans some twenty decibels
 * between an unplugged electric and a strummed acoustic and no single constant
 * serves both. It worked. Almost nobody ever moved it, which is the problem: a
 * tuner that needs calibrating before it can hear you has already lost, and
 * every tuner worth comparing this one to manages without asking.
 *
 * What they do instead is measure the room, and that is what these do. The
 * gate sits a fixed distance above the quietest thing heard recently, and
 * every other absolute threshold in this file already hangs off the gate.
 */

/**
 * How far above the measured room noise the acquire gate sits (+11 dB).
 *
 * Room noise is not steady, and a gate level *with* it opens on the loud half
 * of it. Eleven decibels clears that and is still far below anything worth
 * detecting. In a quiet room it lands within a decibel of where the slider's
 * default sat, which is the behaviour already known to be right.
 */
export const NOISE_HEADROOM = 5.5;
/**
 * The gate may never leave the range the slider offered.
 *
 * Both ends of that range shipped and both worked, which makes them the safe
 * bounds for something now deciding on its own: -68 dBFS at the permissive
 * end, -42.8 at the strict one. An estimate that has gone wrong can therefore
 * only ever be as wrong as a setting the user could already have chosen by
 * hand, which is a much smaller thing to be wrong about.
 */
export const GATE_MIN = 0.0004;
export const GATE_MAX = 0.0072;

/** The acquire gate for a room whose noise floor measures `floor` rms. */
export function gateForNoiseFloor(floor: number): number {
  return Math.min(GATE_MAX, Math.max(GATE_MIN, floor * NOISE_HEADROOM));
}

/**
 * Absolute bottom of the follow gate, -80 dBFS.
 *
 * Not a calibration — it is the level the follow gate used to sit at, kept
 * only so that a microphone delivering digital silence cannot produce a gate
 * of exactly zero, which gates nothing. In any real room the room-relative
 * term is far above this and it never applies.
 *
 * It deliberately does NOT use GATE_MIN. That bound exists to stop the acquire
 * gate becoming more permissive than the most permissive slider position ever
 * was; applying it here would put the follow gate 12 dB *above* a near-silent
 * room and make following a note stricter than acquiring one, which is
 * backwards.
 */
const FOLLOW_MIN = 0.0001;

/** The gate while a note is already being followed — see `FOLLOW_HEADROOM`. */
export function followGateForNoiseFloor(floor: number): number {
  return Math.min(GATE_MAX, Math.max(FOLLOW_MIN, floor * FOLLOW_HEADROOM));
}

/** A quieter room is believed almost at once. */
const FLOOR_FALL_SECONDS = 0.15;
/**
 * A louder one is believed in about a second and a half, once the window below
 * has agreed.
 *
 * This was twelve seconds, and twelve was doing two jobs: following a room
 * that had genuinely changed, and refusing to follow a note. The window does
 * the second job now, and does it properly, so this one is free to be as quick
 * as the first job wants.
 */
const FLOOR_RISE_SECONDS = 1;

/**
 * How much recent history the floor is the minimum of.
 *
 * Long enough that ordinary playing always contains a gap -- the quiet between
 * two plucks, the tail of a decay -- and short enough that a room which has
 * actually changed is believed while the player is still on the same string.
 * Five seconds puts the gate above a room that starts up mid-session in about
 * eight, measured.
 */
export const FLOOR_WINDOW_SECONDS = 5;
/** Resolution of that window. Twenty blocks is enough and costs twenty compares. */
const FLOOR_BLOCK_SECONDS = 0.25;

/**
 * How long a single unbroken run of notes may hold the estimate still.
 *
 * The freeze is the guard against the one case the window cannot handle, which
 * is a note that never stops: bow a violin, or lean on an ebow, for longer than
 * the window and every block in it belongs to the note. Four seconds covers the
 * loud part of anything plucked, and past it the clamp on the gate is what
 * bounds the damage.
 *
 * **The budget is a leaky bucket, not a stopwatch**, and that is the whole
 * point of having one rather than a flag. A room loud enough to trip the onset
 * test trips it about twice a second -- measured at 35 onsets in 24 seconds of
 * nothing but an air conditioner -- so anything timed from the most recent
 * onset can never expire, and neither can anything a momentary gap resets. It
 * fills while a note is on and drains at the same rate while one is not, so a
 * room drumming on the onset test saturates it within a few seconds and leaves
 * it saturated, while ordinary playing (a note, then a gap to hear it in) keeps
 * it somewhere in the middle where a real note still gets its protection.
 */
export const FREEZE_BUDGET_SECONDS = 3;

/**
 * Longest gap anything in here will integrate over.
 *
 * Two things stop the frame loop without stopping the clock: a background tab,
 * where requestAnimationFrame simply does not fire, and the app deafening
 * itself while it makes a sound of its own. Either can leave minutes between
 * consecutive steps, and the tracker's hold measured over a gap that size
 * expires on the first frame back. The floor clamps its own step separately,
 * to one block.
 */
const MAX_DT_SECONDS = 0.1;

/**
 * The room's own level, as the minimum of what has been heard recently.
 *
 * An adaptive floor was written here once and reverted, and the bug is an easy
 * one to write twice: it averaged, so over a long note the average climbed
 * toward the note's own level, the gate climbed with it, the note was cut off
 * by the very thing measuring it, and the floor then sat high across the start
 * of the next one. The fix for that was to freeze the estimate whenever a note
 * was on -- and that turned out to be a worse bug than the one it fixed,
 * because of where the word "note" comes from.
 *
 * **The floor decided what a note was, and a note stopped the floor.** A room
 * loud enough to trip the onset threshold therefore froze the one measurement
 * that would have lifted the threshold out of its way, and it stayed frozen at
 * whatever the room happened to be at that instant, for as long as the app was
 * open. Which way it was then wrong was pure timing. Frozen low, the room read
 * as notes and a reading could sit pinned at a steady cent value indefinitely.
 * Frozen high -- which is what opening the app in a loud room does, since the
 * first frame adopts the room outright -- the gate sat above a quiet
 * instrument, and an unplugged electric had to be hit three times as hard as
 * it should need. All three complaints, one loop.
 *
 * A minimum breaks the loop by not asking. Playing can only make a room
 * louder, so the quietest thing in the last few seconds is the room whether or
 * not anything was played over it, and no part of this needs to know what a
 * note is. Measured against the case that reverted the first attempt -- a
 * pluck every two seconds for twenty-eight seconds -- the estimate does not
 * move off the room at all.
 *
 * What is left is bounded on every side: the window is a minimum so a note
 * cannot lift it, the freeze is the guard for a note with no gaps and it has a
 * budget it cannot renew, and the gate the whole thing feeds is clamped at both
 * ends to a range that used to be selectable by hand.
 */
export class NoiseFloor {
  private readonly blocks: Float32Array;
  private readonly blockSamples: number;
  private readonly freezeSamples: number;

  private at = 0;
  private filled = 0;
  private blockMin = Infinity;
  private inBlock = 0;
  private frozenFor = 0;
  private smoothed = 0;

  constructor(private readonly sampleRate: number) {
    const rate = sampleRate || 48000;
    this.blockSamples = Math.max(1, Math.round(FLOOR_BLOCK_SECONDS * rate));
    this.freezeSamples = Math.round(FREEZE_BUDGET_SECONDS * rate);
    this.blocks = new Float32Array(Math.round(FLOOR_WINDOW_SECONDS / FLOOR_BLOCK_SECONDS));
  }

  /** Current estimate in rms. Zero until the first frame of audio arrives. */
  get value(): number {
    return this.smoothed;
  }

  reset(): void {
    this.at = 0;
    this.filled = 0;
    this.blockMin = Infinity;
    this.inBlock = 0;
    this.frozenFor = 0;
    this.smoothed = 0;
  }

  /**
   * One step.
   *
   * @param env    the short-term level of this frame
   * @param samples how much audio arrived since the last step
   * @param noteOn whether the engine currently believes a note is ringing
   */
  push(env: number, samples: number, noteOn: boolean): number {
    /*
     * Clamped to one block, because two things stop the frame loop without
     * stopping the clock -- a backgrounded tab, where rAF does not fire, and
     * the engine deafening itself while the app makes a sound of its own. An
     * unclamped gap would flush the entire window with the single level that
     * happened to be there on the first frame back.
     */
    const n = Math.min(Math.max(samples, 0), this.blockSamples);

    const frozen = noteOn && this.frozenFor < this.freezeSamples;
    this.frozenFor = Math.max(0, this.frozenFor + (noteOn ? n : -n));

    if (!frozen) {
      if (env < this.blockMin) this.blockMin = env;
      this.inBlock += n;
      if (this.inBlock >= this.blockSamples) {
        this.blocks[this.at] = this.blockMin;
        this.at = (this.at + 1) % this.blocks.length;
        if (this.filled < this.blocks.length) this.filled++;
        this.blockMin = Infinity;
        this.inBlock = 0;
      }
    }

    // The block in progress counts too, so a room that has just gone quiet is
    // believed now rather than a quarter of a second from now.
    let min = this.blockMin;
    for (let i = 0; i < this.filled; i++) {
      if (this.blocks[i] < min) min = this.blocks[i];
    }
    if (!isFinite(min)) min = env;

    // Nothing measured yet. Adopt the room outright rather than spending the
    // first several seconds of use climbing toward it from zero.
    if (this.smoothed <= 0) {
      this.smoothed = min;
      return this.smoothed;
    }

    const tau = min < this.smoothed ? FLOOR_FALL_SECONDS : FLOOR_RISE_SECONDS;
    this.smoothed += (min - this.smoothed) * (1 - Math.exp(-n / this.sampleRate / tau));
    return this.smoothed;
  }
}

/**
 * How far above the silence gate the level has to be before a rise in it is
 * allowed to count as a pluck (~+5 dB).
 *
 * This was an absolute 0.0045 — -47 dBFS — while the gate in a quiet room
 * sits near -60, and those thirteen decibels were a dead band. Anything inside it
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
 * Where the gate sits while a note is already being followed: +3 dB over the
 * room, against +11 to acquire one.
 *
 * "Is anything there" and "is that still there" are different questions and
 * deserve different answers. Acquiring has to be strict or a room invents
 * notes; following one we already have can afford to be more permissive,
 * because a string is known to be ringing and every reading still has to clear
 * the clarity test on its way out.
 *
 * This was expressed as a fraction of the acquire gate — a quarter of it,
 * -12 dB — and that was safe only while the acquire gate was a fixed number
 * someone had chosen. Measured from the room instead, a quarter of it works
 * out at 3.5 x 0.25 = 0.875, which is *below the room*, and a gate below the
 * noise floor is not a gate. It can never fire, so once anything was on screen
 * the level test stopped guarding at all and clarity was the only thing left
 * holding the door. A room with any tonal content in it — mains hum, a fan,
 * the 240 Hz that reads as a note between A# and B — clears a clarity
 * threshold easily, because a hum is a sine and a sine is perfectly periodic.
 * Readings then appeared from nothing and notes would not die.
 *
 * So it is a headroom over the room in its own right, not a fraction of
 * another one. Three decibels means the window has to hold about as much note
 * as room, which is the same place the detector gives up anyway: it is not
 * throwing away signal, it is declining to keep a dead note alive on a
 * technicality.
 */
export const FOLLOW_HEADROOM = 2.75;
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
 * perfectly detectable. It is still a guard, just a less twitchy one: the
 * string latch and the disagreement test in TunerController are what actually
 * stop the reading wandering onto a neighbour during the tail, and they are
 * untouched.
 *
 * Then it was -38, and measurement said that was still early. Rendering a
 * pluck of each string into a room and asking two questions of every frame —
 * has this rule fired yet, and can the detector still read the note — put this
 * rule first on every string in a quiet or normal room, by four to six tenths
 * of a second each time. It was ending notes that were still being read
 * correctly, which is the whole of "I wish it held on a bit longer".
 *
 * The room is why. The envelope this compares contains the room as well as the
 * note, so it can never fall below the room's own level: in a quiet room the
 * rule fires early, and in a living room it never fires at all. At -50 dB it
 * stops firing first anywhere, which makes every room behave like the loud one
 * already did and leaves the decision to the detector — the only part of this
 * that can actually tell whether a note is still there.
 */
const NOTE_OFF_RATIO = 0.003;
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

  /**
   * Minimum NSDF peak height for a reading to be trusted.
   *
   * The second thing the sensitivity slider moved, and unlike the gate it is
   * not a level at all: it is how periodic a window has to look, which does
   * not depend on the room. There was nothing for it to adapt to, so it is
   * simply the value the default slider position produced, kept to the digit
   * so that taking the slider away changed nothing about what is accepted.
   */
  clarityThreshold = 0.456;

  /**
   * The room's own level, in rms, as far as it has been measured — see
   * NoiseFloor. Zero until the first frame of audio arrives.
   *
   * Mirrored out of the estimator every frame rather than owned here, so that
   * everything downstream — the gate, the onset floor, the debug HUD — reads
   * one number and none of them has to know how it is arrived at.
   */
  noiseFloor = 0;
  private floor = new NoiseFloor(48000);
  /** `written` at the last floor step, so the step can be timed in samples. */
  private floorAt = 0;

  /** RMS floor below which the input is treated as silence. */
  get rmsGate(): number {
    return gateForNoiseFloor(this.noiseFloor);
  }

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
  /** Wall clock of the last chunk to arrive from the capture graph. */
  private lastPushAt = 0;

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
      // Its window is measured in samples, so it cannot be built until the
      // context has said what a second is.
      this.floor = new NoiseFloor(ctx.sampleRate);

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

      // Stamped here rather than waiting for the first chunk, so `capturing`
      // does not read false for the few milliseconds before one arrives.
      this.lastPushAt = performance.now();
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
    this.lastPushAt = 0;
    this.resetEnvelope();
    if (this.state !== 'error') this.state = 'idle';
  }

  private resetEnvelope(): void {
    this.envelope = 0;
    this.prevEnvelope = 0;
    // Measured from the room, so a new room starts from nothing rather than
    // from whatever the last one happened to be.
    this.noiseFloor = 0;
    this.floor.reset();
    this.floorAt = 0;
    this.sustainRef = 0;
    this.samplesAtOnset = 0;
    this.noteOn = false;
    this.pastAttack = true;
    this.onsetFlag = false;
  }

  /* -------------------------------------------------------------- capture -- */

  private push(samples: Float32Array): void {
    this.lastPushAt = performance.now();
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
   * Whether audio is actually arriving, as opposed to whether the engine
   * believes it is running.
   *
   * Those are different states and nothing else here could tell them apart.
   * `state` is set by this class and only this class: iOS can take the audio
   * session away — another app wanting the microphone, a call, the OS
   * reclaiming it across a switch — and the graph goes quiet without a single
   * event any of this code is listening for. `state` stays `running`, which
   * is then believed by `start()`, which returns early, and by the resume
   * handler, which does the same. A tuner that has stopped hearing anything
   * and a tuner in a silent room look identical from the outside, so this is
   * the only honest way to ask.
   *
   * A chunk is 512 samples, so at any real rate they arrive every ten or
   * eleven milliseconds. A whole second of nothing is not a quiet room.
   */
  get capturing(): boolean {
    return this.state === 'running' && performance.now() - this.lastPushAt < 1000;
  }

  /**
   * Try to wake a context that was suspended out from under us.
   *
   * The cheap half of recovering a dead graph, and the half worth trying
   * first. A suspended context runs no worklet, so no chunks arrive and
   * `capturing` goes false -- which looks exactly like the session having
   * been taken away, and is not: everything is still wired up and one call
   * fixes it. Tearing the graph down and building a new one also fixes it,
   * at the cost of a new `getUserMedia` and a fresh context, and it is the
   * wrong first answer to a question this cheap to ask.
   *
   * Returns whether the context is running afterwards. False covers both the
   * resume being refused and there being no context at all, which the caller
   * treats the same way: escalate.
   */
  async resumeContext(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    return ctx.state === 'running';
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

    /*
     * Measure the room, then decide with it. `noteOn` is one frame stale here
     * and has to be, since the estimate is read further down this same frame;
     * the cost is that the frame an onset lands on is seen as room noise, and
     * against a minimum taken over five seconds one frame is not a cost.
     */
    const since = this.written - this.floorAt;
    this.floorAt = this.written;
    this.noiseFloor = this.floor.push(env, since, this.noteOn);
    const dt = Math.min(since / (this.sampleRate || 48000), MAX_DT_SECONDS);

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

    /*
     * Guard 1: hold everything steady while the pick transient is still inside
     * the analysis window.
     *
     * The hold goes through the tracker rather than returning `last` untouched,
     * and that matters more than it looks. Returning early skipped the tracker
     * entirely, so its half-second hold never started counting — and the blank
     * is 213 ms but a fresh onset re-arms it after only 34 ms. Anything firing
     * onsets faster than the blank expires therefore froze the reading on
     * screen *indefinitely*, perfectly steady, with nothing counting down. A
     * note that had already stopped could sit there for as long as the room
     * kept tripping the onset test.
     *
     * Feeding the tracker silence instead bounds it: a real pluck resets the
     * count through `noteAttack` and then produces readings long before half a
     * second is up, so nothing changes there, while a blank that will not stop
     * re-arming now expires like any other silence.
     */
    if (!attackClear) {
      this.last = this.tracker.update({ frequency: 0, clarity: 0, rms: env }, false, dt);
      return this.last;
    }

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
    const gate = following ? followGateForNoiseFloor(this.noiseFloor) : this.rmsGate;

    let raw = noteDead
      ? { frequency: 0, clarity: 0, rms: env }
      : detector.detect(scratch, this.clarityThreshold, gate);

    // Down in the relaxed range, a reading that is nowhere near the note being
    // followed is a slip onto a sub-multiple, not a change of mind.
    if (following && raw.frequency > 0 && tooFarToFollow(this.last.frequency, raw.frequency)) {
      raw = { frequency: 0, clarity: raw.clarity, rms: raw.rms };
    }

    // `dt` rather than a frame count, so the hold lasts the same length of
    // time on a 120 Hz screen as on a 60 Hz one.
    this.last = this.tracker.update(raw, settling, dt);

    /*
     * Nothing on screen means the note is over, whatever its level says.
     *
     * `noteDead` was the only way out of `noteOn`, and it compares the level
     * against the note's own sustain: fifty decibels down, which is a fall no
     * envelope containing a room can ever make, because the envelope cannot go
     * below the room. So in any room with anything audible in it the flag
     * latched on the first pluck and stayed on for the life of the session,
     * taking `decayFraction` and the freeze above with it.
     *
     * This is the way out that does not depend on a level at all. It reads the
     * tracker, which has already applied its own half-second hold, so a dropout
     * mid-decay does not end the note -- only the tracker actually giving up
     * does. It sits after the update rather than before it, and past settling,
     * so that the frames where there is legitimately nothing yet (the attack
     * blank, and the first reading of a note that has not been acquired) cannot
     * end a note that has only just started.
     */
    if (!settling && this.last.frequency <= 0) this.noteOn = false;

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

  /**
   * The last analysed window's power spectrum, or null before there is one.
   *
   * A view of the detector's own buffer rather than a copy: it is overwritten
   * every frame and read within the same frame, and handing out sixty
   * throwaway arrays a second to avoid a mutation nobody observes is the
   * wrong trade. See PitchDetector.spectrum for what is in it.
   */
  get spectrum(): Float32Array | null {
    return this.detector?.spectrum ?? null;
  }

  /** Hz per bin of `spectrum`, or 0 when there is no detector yet. */
  get spectrumBinHz(): number {
    return this.detector?.spectrumBinHz ?? 0;
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
