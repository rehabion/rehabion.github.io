/* Microphone → 16 kHz 16-bit PCM chunks (~100 ms) for Gemini Live, plus a level for the orb. */
class MicPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0; this.sum = 0; this.n = 0;
    this.out = new Int16Array(1600); this.i = 0; this.level = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let k = 0; k < ch.length; k++) {
      const v = ch[k];
      this.sum += v; this.n++; this.acc++;
      this.level = Math.max(this.level * 0.9995, Math.abs(v));
      if (this.acc >= this.ratio) {           /* average-then-decimate keeps it clean enough for speech */
        const s = Math.max(-1, Math.min(1, this.sum / this.n));
        this.out[this.i++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.acc -= this.ratio; this.sum = 0; this.n = 0;
        if (this.i === this.out.length) {
          this.port.postMessage({ pcm: this.out.buffer, level: this.level }, [this.out.buffer]);
          this.out = new Int16Array(1600); this.i = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('mic-pcm', MicPCM);
