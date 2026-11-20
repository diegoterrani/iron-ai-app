// Roda na thread de áudio: junta as amostras em pedaços de ~250 ms, converte
// para PCM de 16 bits e entrega à página. O AudioContext já está em 16 kHz.
class CapturaPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(4000);
    this.usado = 0;
  }

  process(entradas) {
    const canal = entradas[0]?.[0];
    if (!canal) return true;
    for (let i = 0; i < canal.length; i++) {
      const amostra = Math.max(-1, Math.min(1, canal[i]));
      this.buffer[this.usado++] = amostra < 0 ? amostra * 0x8000 : amostra * 0x7fff;
      if (this.usado === this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0).buffer);
        this.usado = 0;
      }
    }
    return true;
  }
}

registerProcessor("captura-pcm", CapturaPcm);
