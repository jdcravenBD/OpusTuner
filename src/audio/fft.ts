/**
 * Minimal in-place iterative radix-2 FFT.
 *
 * Allocation-free after construction — `transform` is called once per analysis
 * frame (~60/s) so it must not create garbage.
 */
export class FFT {
  readonly size: number;
  private readonly levels: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.levels = Math.log2(size) | 0;

    const half = size / 2;
    this.cosTable = new Float32Array(half);
    this.sinTable = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }

    // Precomputed bit-reversal permutation.
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let j = 0; j < this.levels; j++) r |= ((i >>> j) & 1) << (this.levels - 1 - j);
      this.reverse[i] = r;
    }
  }

  /** Forward transform, in place. */
  transform(real: Float32Array, imag: Float32Array): void {
    const n = this.size;

    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) {
        let t = real[i];
        real[i] = real[j];
        real[j] = t;
        t = imag[i];
        imag[i] = imag[j];
        imag[j] = t;
      }
    }

    for (let size = 2; size <= n; size *= 2) {
      const halfsize = size / 2;
      const tablestep = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
          const l = j + halfsize;
          const cos = this.cosTable[k];
          const sin = this.sinTable[k];
          const tre = real[l] * cos + imag[l] * sin;
          const tim = -real[l] * sin + imag[l] * cos;
          real[l] = real[j] - tre;
          imag[l] = imag[j] - tim;
          real[j] += tre;
          imag[j] += tim;
        }
      }
    }
  }

  /** Inverse transform (unscaled — caller divides by `size`), in place. */
  inverse(real: Float32Array, imag: Float32Array): void {
    // IFFT(x) = conj(FFT(conj(x)))
    for (let i = 0; i < this.size; i++) imag[i] = -imag[i];
    this.transform(real, imag);
    for (let i = 0; i < this.size; i++) imag[i] = -imag[i];
  }
}
