/**
 * Escuta no navegador: captura o áudio (microfone e, opcional, o áudio de uma
 * aba de videochamada), manda ao Worker de transcrição e devolve os eventos.
 *
 * Só roda no navegador (Chrome ou Edge). O áudio vai direto ao Worker e não
 * passa pelo app; o app recebe só o texto, pela tela.
 *
 * Captura com ScriptProcessorNode (e não AudioWorklet): o worklet precisaria
 * carregar um script separado, que a CSP do app ('strict-dynamic') bloqueia.
 * A conversão é leve: blocos de 4096 amostras a 16 kHz (~4 por segundo).
 */

export type CanalAudio = "microfone" | "aba";

export interface EventosEscuta {
  aoAbrir?: () => void;
  aoParcial?: (canal: CanalAudio, texto: string, falante?: number) => void;
  aoFinal?: (canal: CanalAudio, texto: string, falante?: number) => void;
  aoBloco?: (texto: string) => void;
  aoRenovar?: (exp: number) => void;
  aoErro?: (codigo: string) => void;
  aoFechar?: (codigo: number) => void;
}

const BYTE_CANAL: Record<CanalAudio, number> = { microfone: 0, aba: 1 };
const AMOSTRAS = 4096;

interface Fonte {
  stream: MediaStream;
  no: MediaStreamAudioSourceNode;
  processador: ScriptProcessorNode;
}

/** O navegador tem o que a escuta precisa? (Firefox e Safari não capturam o áudio da aba.) */
export function suportaEscuta(): { microfone: boolean; aba: boolean } {
  if (typeof window === "undefined") return { microfone: false, aba: false };
  const md = navigator.mediaDevices;
  const audio = typeof AudioContext !== "undefined" && typeof WebSocket !== "undefined";
  return { microfone: audio && !!md?.getUserMedia, aba: audio && !!md?.getDisplayMedia };
}

function lerMensagem(dado: unknown): Record<string, unknown> | null {
  if (typeof dado !== "string" || dado.length > 20_000) return null;
  try {
    const m = JSON.parse(dado) as unknown;
    return m !== null && typeof m === "object" ? (m as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class ConexaoEscuta {
  private ws: WebSocket;
  private contexto: AudioContext | null = null;
  private fontes = new Map<CanalAudio, Fonte>();
  /** Canais cujo áudio está sendo enviado (pergunta a pergunta liga só enquanto a pessoa responde). */
  private ativos = new Set<CanalAudio>();
  private fechada = false;

  constructor(endereco: string, protocolo: string, token: string, private readonly eventos: EventosEscuta) {
    // O token vai como subprotocolo, fora da URL (que cai em logs).
    this.ws = new WebSocket(endereco, [protocolo, token]);
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", (e) => this.aoMensagem(e.data));
    this.ws.addEventListener("close", (e) => this.aoFecharWs(e.code));
    this.ws.addEventListener("error", () => this.eventos.aoErro?.("conexao"));
  }

  get aberta(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  canais(): CanalAudio[] {
    return [...this.fontes.keys()];
  }

  private aoMensagem(dado: unknown): void {
    const m = lerMensagem(dado);
    if (!m) return;
    const canal = m.canal === "microfone" || m.canal === "aba" ? m.canal : null;
    const falante = typeof m.falante === "number" && Number.isInteger(m.falante) ? m.falante : undefined;
    switch (m.tipo) {
      case "pronto":
        this.eventos.aoAbrir?.();
        break;
      case "parcial":
        if (canal && typeof m.texto === "string") this.eventos.aoParcial?.(canal, m.texto, falante);
        break;
      case "final":
        if (canal && typeof m.texto === "string") this.eventos.aoFinal?.(canal, m.texto, falante);
        break;
      case "bloco":
        if (typeof m.texto === "string") this.eventos.aoBloco?.(m.texto);
        break;
      case "renovado":
        if (typeof m.exp === "number") this.eventos.aoRenovar?.(m.exp);
        break;
      case "erro":
        if (typeof m.codigo === "string") this.eventos.aoErro?.(m.codigo);
        break;
    }
  }

  private aoFecharWs(codigo: number): void {
    if (this.fechada) return;
    this.fechada = true;
    this.pararAudio();
    this.eventos.aoFechar?.(codigo);
  }

  private async contextoAudio(): Promise<AudioContext> {
    if (!this.contexto) this.contexto = new AudioContext({ sampleRate: 16000 });
    if (this.contexto.state === "suspended") await this.contexto.resume();
    return this.contexto;
  }

  private async ligarFonte(canal: CanalAudio, stream: MediaStream): Promise<void> {
    const ctx = await this.contextoAudio();
    const no = ctx.createMediaStreamSource(stream);
    const processador = ctx.createScriptProcessor(AMOSTRAS, 1, 1);
    // Saída muda: o processador precisa estar ligado ao destino para rodar, mas nada toca no alto-falante.
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    processador.onaudioprocess = (e) => {
      if (!this.ativos.has(canal) || this.ws.readyState !== WebSocket.OPEN) return;
      const entrada = e.inputBuffer.getChannelData(0);
      const quadro = new Uint8Array(1 + entrada.length * 2);
      quadro[0] = BYTE_CANAL[canal];
      const pcm = new DataView(quadro.buffer, 1);
      for (let i = 0; i < entrada.length; i++) {
        const a = Math.max(-1, Math.min(1, entrada[i] ?? 0));
        pcm.setInt16(i * 2, a < 0 ? a * 0x8000 : a * 0x7fff, true);
      }
      this.ws.send(quadro);
    };
    no.connect(processador);
    processador.connect(mudo);
    mudo.connect(ctx.destination);
    // Se a pessoa encerrar o compartilhamento pelo navegador, o canal sai sozinho.
    for (const t of stream.getAudioTracks()) t.addEventListener("ended", () => this.removerFonte(canal));
    this.fontes.set(canal, { stream, no, processador });
  }

  /** Liga o microfone (pede permissão ao navegador). */
  async adicionarMicrofone(): Promise<void> {
    if (this.fontes.has("microfone")) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
    await this.ligarFonte("microfone", stream);
  }

  /** Liga o áudio de uma aba (a pessoa escolhe a aba da chamada e marca "compartilhar áudio"). */
  async adicionarAba(): Promise<boolean> {
    if (this.fontes.has("aba")) return true;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    // O vídeo não é usado: para na hora.
    for (const t of stream.getVideoTracks()) t.stop();
    if (stream.getAudioTracks().length === 0) {
      for (const t of stream.getTracks()) t.stop();
      return false;
    }
    await this.ligarFonte("aba", stream);
    return true;
  }

  removerFonte(canal: CanalAudio): void {
    const f = this.fontes.get(canal);
    if (!f) return;
    f.processador.onaudioprocess = null;
    f.no.disconnect();
    f.processador.disconnect();
    for (const t of f.stream.getTracks()) t.stop();
    this.fontes.delete(canal);
    this.ativos.delete(canal);
  }

  /** Começa ou para de enviar o áudio de um canal (o microfone segue aberto). */
  transmitir(canal: CanalAudio, ligado: boolean): void {
    if (ligado) this.ativos.add(canal);
    else this.ativos.delete(canal);
  }

  /** Renova o token sem derrubar a conexão (a marcação "Sou eu" continua valendo). */
  renovar(token: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ tipo: "renovar", token }));
  }

  private pararAudio(): void {
    for (const c of [...this.fontes.keys()]) this.removerFonte(c);
    void this.contexto?.close().catch(() => undefined);
    this.contexto = null;
  }

  /** Para o áudio e fecha a conexão. */
  fechar(): void {
    this.pararAudio();
    if (!this.fechada) {
      this.fechada = true;
      try {
        this.ws.close(1000, "fim");
      } catch {
        // já fechada
      }
    }
  }
}
