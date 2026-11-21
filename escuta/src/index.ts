import { DurableObject } from "cloudflare:workers";
import { Segmentador, type Bloco, type Canal } from "./segmentador";
import { ARQUIVOS_TESTE, VALIDADE_TOKEN_TESTE_S, cabecalhosTeste, codigoConfere, modoTesteLigado } from "./teste";
import { assinarToken, conferirToken } from "./token";

/**
 * Escuta de reuniões da IRON AI (Fase 1: prova de áudio).
 *
 * Navegador --(WebSocket: áudio PCM)--> Worker --> Durable Object da reunião
 *   --(WebSocket)--> Deepgram Nova-3 no Workers AI --> transcrição de volta.
 *
 * O que NÃO acontece aqui, de propósito:
 * - nada é gravado (nem áudio, nem transcrição): o Durable Object só mantém
 *   em memória o bloco em formação;
 * - nenhum texto de reunião vai para o log: só códigos e contagens.
 */

export interface Env {
  AI: Ai;
  REUNIAO: DurableObjectNamespace<ReuniaoEscuta>;
  /** Origens autorizadas, separadas por vírgula. */
  ORIGENS_PERMITIDAS: string;
  /** Segredo do token curto (wrangler secret). */
  ESCUTA_TOKEN_SECRET: string;
  /** Arquivos da página de teste (escuta/teste). Só são servidos no modo de teste. */
  ASSETS: Fetcher;
  /** Código de acesso da página de teste. Cadastrado = modo de teste ligado. */
  TESTE_CODIGO?: string;
}

/** Subprotocolo do WebSocket. O token vai como segundo subprotocolo, fora da URL (que cai em logs). */
const PROTOCOLO = "escuta.v1";

/** Primeiro byte de cada quadro de áudio diz o canal. */
const CANAIS: Record<number, Canal> = { 0: "microfone", 1: "aba" };

/** 16 kHz, 16 bits, mono: 32.000 bytes por segundo. 1 s por quadro é folga larga. */
const MAX_BYTES_QUADRO = 1 + 32_000;
const INTERVALO_VERIFICACAO_MS = 1000;
/** Teto de duração de uma escuta: reunião esquecida aberta não gasta para sempre. */
const MAX_DURACAO_MS = 4 * 60 * 60 * 1000;

/**
 * Parâmetros do Nova-3. `encoding`, `sample_rate` e `interim_results` estão
 * no exemplo oficial; `language`, `smart_format` e `endpointing` seguem a
 * página do modelo e precisam ser confirmados no primeiro teste real.
 */
const PARAMETROS_STT = {
  encoding: "linear16",
  sample_rate: "16000",
  language: "pt-BR",
  interim_results: true,
  smart_format: true,
  endpointing: "300",
};

function origemPermitida(env: Env, origem: string | null, origemDoWorker: string): boolean {
  if (!origem) return false;
  // No modo de teste, a página servida pelo próprio Worker também pode abrir a escuta.
  if (modoTesteLigado(env.TESTE_CODIGO) && origem === origemDoWorker) return true;
  return env.ORIGENS_PERMITIDAS.split(",").map((o) => o.trim()).filter(Boolean).includes(origem);
}

/** Página de teste e emissão do token de teste. Tudo responde 404 com o modo desligado. */
async function atenderTeste(request: Request, env: Env, url: URL): Promise<Response> {
  const naoEncontrado = new Response("Não encontrado", { status: 404 });
  if (!modoTesteLigado(env.TESTE_CODIGO)) return naoEncontrado;
  const cabecalhos = cabecalhosTeste(url.host);

  if (url.pathname === "/teste") return Response.redirect(`${url.origin}/teste/`, 308);

  if (url.pathname === "/teste/token") {
    if (request.method !== "POST") return new Response("Método não permitido", { status: 405, headers: cabecalhos });
    // Só a própria página pede token: outro site não consegue usar o código de alguém.
    if (request.headers.get("Origin") !== url.origin) return new Response("Origem não autorizada", { status: 403, headers: cabecalhos });
    let codigo: unknown;
    try {
      const corpo = await request.text();
      if (corpo.length > 1024) throw new Error("grande");
      codigo = (JSON.parse(corpo) as { codigo?: unknown }).codigo;
    } catch {
      return new Response("Pedido inválido", { status: 400, headers: cabecalhos });
    }
    if (typeof codigo !== "string" || !(await codigoConfere(codigo, env.TESTE_CODIGO))) {
      log("teste.codigo_recusado");
      return new Response("Código incorreto", { status: 401, headers: cabecalhos });
    }
    // Reunião fictícia nova a cada token: o teste nunca cai numa reunião real.
    const token = await assinarToken(
      { sessao: crypto.randomUUID(), sub: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + VALIDADE_TOKEN_TESTE_S },
      env.ESCUTA_TOKEN_SECRET,
    );
    log("teste.token_emitido");
    return Response.json({ token }, { headers: cabecalhos });
  }

  const arquivo = ARQUIVOS_TESTE[url.pathname];
  if (!arquivo || request.method !== "GET") return naoEncontrado;
  const resposta = await env.ASSETS.fetch(new Request(new URL(arquivo, url.origin)));
  if (!resposta.ok) return naoEncontrado;
  const saida = new Response(resposta.body, resposta);
  for (const [nome, valor] of Object.entries(cabecalhos)) saida.headers.set(nome, valor);
  return saida;
}

function log(evento: string, dados: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ evento, ...dados }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/saude") return Response.json({ ok: true });
    // Falha fechado: sem segredo configurado, ninguém entra nem recebe token.
    const configurado = !!env.ESCUTA_TOKEN_SECRET && env.ESCUTA_TOKEN_SECRET.length >= 32;
    if (url.pathname === "/teste" || url.pathname.startsWith("/teste/")) {
      if (!configurado) return new Response("Não encontrado", { status: 404 });
      return atenderTeste(request, env, url);
    }
    if (url.pathname !== "/escuta") return new Response("Não encontrado", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Esperado WebSocket", { status: 426 });
    }
    if (!configurado) {
      log("escuta.sem_config");
      return new Response("Indisponível", { status: 503 });
    }
    // Navegador sempre manda Origin em WebSocket; outro site abrindo a conexão é barrado aqui.
    if (!origemPermitida(env, request.headers.get("Origin"), url.origin)) {
      log("escuta.origem_recusada");
      return new Response("Origem não autorizada", { status: 403 });
    }

    const protocolos = (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(",").map((p) => p.trim());
    if (protocolos.length !== 2 || protocolos[0] !== PROTOCOLO) return new Response("Protocolo inválido", { status: 400 });
    const token = await conferirToken(protocolos[1] ?? "", env.ESCUTA_TOKEN_SECRET, Date.now());
    if (!token.ok) {
      log("escuta.token_recusado", { motivo: token.motivo });
      return new Response("Não autorizado", { status: 401 });
    }

    // Um Durable Object por reunião: duas abas da mesma reunião caem no mesmo objeto.
    const stub = env.REUNIAO.getByName(token.payload.sessao);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

type MensagemCliente =
  | { tipo: "pronto" }
  | { tipo: "parcial"; canal: Canal; texto: string }
  | { tipo: "final"; canal: Canal; texto: string }
  | { tipo: "bloco"; numero: number; motivo: Bloco["motivo"]; texto: string }
  | { tipo: "erro"; codigo: string; detalhe?: string };

export class ReuniaoEscuta extends DurableObject<Env> {
  private cliente: WebSocket | null = null;
  private stt = new Map<Canal, WebSocket>();
  private abrindo = new Map<Canal, Promise<WebSocket | null>>();
  private segmentador = new Segmentador();
  private relogio: ReturnType<typeof setInterval> | null = null;
  private inicioMs = 0;
  private blocos = 0;

  // A validação (origem e token) já foi feita no Worker; só ele alcança este objeto.
  async fetch(_request: Request): Promise<Response> {
    // Uma escuta por reunião: a conexão nova substitui a antiga (aba recarregada).
    if (this.cliente) this.encerrar(4001, "substituída por nova conexão");

    const par = new WebSocketPair();
    const [paraNavegador, servidor] = [par[0], par[1]];
    // Com a data de compatibilidade atual o padrão é Blob; o áudio precisa chegar como ArrayBuffer.
    servidor.binaryType = "arraybuffer";
    servidor.accept();
    this.cliente = servidor;
    this.segmentador = new Segmentador();
    this.inicioMs = Date.now();
    this.blocos = 0;

    servidor.addEventListener("message", (e) => this.aoReceber(servidor, e.data));
    servidor.addEventListener("close", () => this.aoFechar(servidor));
    servidor.addEventListener("error", () => this.aoFechar(servidor));

    this.relogio = setInterval(() => this.aCadaSegundo(), INTERVALO_VERIFICACAO_MS);
    this.enviar({ tipo: "pronto" });
    log("escuta.aberta");
    return new Response(null, { status: 101, webSocket: paraNavegador, headers: { "Sec-WebSocket-Protocol": PROTOCOLO } });
  }

  private async aoReceber(origem: WebSocket, dado: string | ArrayBuffer): Promise<void> {
    if (origem !== this.cliente) return;
    // O cliente só manda áudio (binário). Texto é ignorado: não há comandos a aceitar.
    if (typeof dado === "string") return;
    if (dado.byteLength < 3 || dado.byteLength > MAX_BYTES_QUADRO) {
      this.enviar({ tipo: "erro", codigo: "quadro_invalido" });
      return;
    }
    const canal = CANAIS[new Uint8Array(dado, 0, 1)[0] ?? -1];
    if (!canal) {
      this.enviar({ tipo: "erro", codigo: "canal_invalido" });
      return;
    }
    const stt = await this.conexaoStt(canal);
    if (stt && stt.readyState === WebSocket.OPEN) stt.send(dado.slice(1));
  }

  /** Abre (uma vez por canal) a conexão com o Nova-3. */
  private conexaoStt(canal: Canal): Promise<WebSocket | null> {
    const aberta = this.stt.get(canal);
    if (aberta) return Promise.resolve(aberta);
    let pendente = this.abrindo.get(canal);
    if (!pendente) {
      pendente = this.abrirStt(canal).finally(() => this.abrindo.delete(canal));
      this.abrindo.set(canal, pendente);
    }
    return pendente;
  }

  private async abrirStt(canal: Canal): Promise<WebSocket | null> {
    try {
      // Os tipos do binding ainda não descrevem a opção `websocket`.
      const executar = this.env.AI.run.bind(this.env.AI) as unknown as (
        modelo: string,
        entrada: Record<string, unknown>,
        opcoes: { websocket: true },
      ) => Promise<Response>;
      const resposta = await executar("@cf/deepgram/nova-3", PARAMETROS_STT, { websocket: true });
      const ws = resposta.webSocket;
      if (!ws) throw new Error(`sem websocket (status ${resposta.status})`);
      ws.accept();
      ws.addEventListener("message", (e) => this.aoTranscrever(canal, e.data));
      ws.addEventListener("close", () => this.sttCaiu(canal, ws));
      ws.addEventListener("error", () => this.sttCaiu(canal, ws));
      this.stt.set(canal, ws);
      log("escuta.stt_aberto", { canal });
      return ws;
    } catch (err) {
      // Só o nome do erro: a mensagem pode trazer conteúdo.
      log("escuta.stt_falhou", { canal, erro: err instanceof Error ? err.name : "desconhecido" });
      // No modo de teste a mensagem ajuda a achar parâmetro recusado; em produção não sai do Worker.
      const detalhe = this.env.TESTE_CODIGO && err instanceof Error ? err.message.slice(0, 300) : undefined;
      this.enviar({ tipo: "erro", codigo: "stt_indisponivel", detalhe });
      return null;
    }
  }

  private sttCaiu(canal: Canal, ws: WebSocket): void {
    if (this.stt.get(canal) !== ws) return;
    this.stt.delete(canal);
    log("escuta.stt_caiu", { canal });
    // A próxima leva de áudio reabre a conexão; o cliente é avisado para mostrar o corte.
    this.enviar({ tipo: "erro", codigo: "stt_reconectando" });
  }

  private aoTranscrever(canal: Canal, dado: string | ArrayBuffer): void {
    if (typeof dado !== "string") return;
    let msg: { is_final?: unknown; channel?: { alternatives?: { transcript?: unknown }[] } };
    try {
      msg = JSON.parse(dado);
    } catch {
      return;
    }
    const texto = msg.channel?.alternatives?.[0]?.transcript;
    if (typeof texto !== "string" || !texto.trim()) return;
    if (msg.is_final !== true) {
      this.enviar({ tipo: "parcial", canal, texto });
      return;
    }
    this.enviar({ tipo: "final", canal, texto });
    for (const bloco of this.segmentador.adicionar({ canal, texto }, Date.now())) this.entregar(bloco);
  }

  private aCadaSegundo(): void {
    if (Date.now() - this.inicioMs > MAX_DURACAO_MS) {
      this.encerrar(4002, "tempo máximo de escuta");
      return;
    }
    const bloco = this.segmentador.verificar(Date.now());
    if (bloco) this.entregar(bloco);
  }

  private entregar(bloco: Bloco): void {
    this.blocos += 1;
    this.enviar({ tipo: "bloco", numero: bloco.numero, motivo: bloco.motivo, texto: bloco.texto });
    // Só tamanho e motivo no log, nunca o texto.
    log("escuta.bloco", { numero: bloco.numero, motivo: bloco.motivo, caracteres: bloco.texto.length });
  }

  private enviar(msg: MensagemCliente): void {
    if (this.cliente?.readyState === WebSocket.OPEN) this.cliente.send(JSON.stringify(msg));
  }

  private aoFechar(origem: WebSocket): void {
    if (origem !== this.cliente) return;
    this.encerrar(1000, "cliente saiu");
  }

  private encerrar(codigo: number, motivo: string): void {
    const resto = this.segmentador.encerrar();
    if (resto) this.entregar(resto);
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
    for (const ws of this.stt.values()) {
      try {
        ws.close(1000, "fim");
      } catch {
        // já fechado
      }
    }
    this.stt.clear();
    const cliente = this.cliente;
    this.cliente = null;
    try {
      cliente?.close(codigo, motivo);
    } catch {
      // já fechado
    }
    log("escuta.encerrada", { codigo, blocos: this.blocos, segundos: Math.round((Date.now() - this.inicioMs) / 1000) });
  }
}
