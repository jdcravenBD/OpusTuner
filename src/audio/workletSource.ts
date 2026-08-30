/**
 * AudioWorklet processor source.
 *
 * Kept as a string and loaded from a Blob URL rather than a separate file:
 * `addModule` needs a classic-script URL, and a blob works identically in the
 * Vite dev server, a static build, and inside a Capacitor WebView without any
 * bundler configuration or asset-path juggling.
 *
 * The processor does no analysis — it only batches the 128-sample render
 * quanta into larger chunks and ships them to the main thread, so nothing
 * heavy ever runs on the realtime audio thread.
 */
/*
 * One constant, used to register the processor here and to construct the node
 * in AudioEngine. The two must agree exactly, so it is never written twice.
 */
export const CAPTURE_PROCESSOR_NAME = 'easy-as-tuning-capture';

export const workletSource = /* js */ `
class EasyAsTuningCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunkSize = opts.chunkSize || 512;
    this.buffer = new Float32Array(this.chunkSize);
    this.filled = 0;
    this.closed = false;
    this.port.onmessage = (e) => {
      if (e.data === 'close') this.closed = true;
    };
  }

  process(inputs) {
    if (this.closed) return false;

    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const buf = this.buffer;
    const size = this.chunkSize;
    for (let i = 0; i < channel.length; i++) {
      buf[this.filled++] = channel[i];
      if (this.filled === size) {
        const copy = new Float32Array(buf);
        this.port.postMessage(copy, [copy.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR_NAME)}, EasyAsTuningCapture);
`;
