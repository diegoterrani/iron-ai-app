import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Questionario } from "@/lib/assessment/questionario";
import { definirFerramentas, executarFerramenta, type EstadoAgente, type Sinal } from "./ferramentas";
import { montarPromptSistema } from "./prompt";

/**
 * Um turno do agente: a mensagem do cliente entra, o agente responde e pode
 * chamar ferramentas (várias rodadas) até devolver texto.
 *
 * Sem banco e sem rede aqui dentro: quem chama passa o histórico, o estado e
 * a função que fala com a API. Assim os testes rodam com uma API simulada e
 * a autorização fica toda na Server Action (sessão, RLS e teto no banco).
 */

export const MODELO_AGENTE = "claude-opus-5-5";
/** Chamadas à API por mensagem do cliente (cada ferramenta usada abre outra). */
export const MAX_RODADAS = 8;
export const MAX_TEXTO_CLIENTE = 2000;
const MAX_TOKENS_RESPOSTA = 8000;

export type ChamarLLM = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export interface Uso {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export interface ResultadoTurno {
  /** Histórico completo para gravar (só cresce: nada do que já existia muda). */
  historico: Anthropic.Beta.BetaMessageParam[];
  estado: EstadoAgente;
  alterou: boolean;
  /** Textos do agente neste turno, na ordem. */
  textos: string[];
  sinais: Sinal[];
  uso: Uso;
  fim: "ok" | "recusa" | "rodadas" | "corte";
}

/** Monta a chamada: prompt e ferramentas fixos primeiro, para o cache de prompt valer entre turnos. */
export function parametros(q: Questionario, mensagens: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model: MODELO_AGENTE,
    max_tokens: MAX_TOKENS_RESPOSTA,
    system: [{ type: "text", text: montarPromptSistema(q), cache_control: { type: "ephemeral" } }],
    tools: definirFerramentas(q),
    messages: mensagens,
    // Conversa guiada: esforço baixo responde rápido e gasta menos (custo do doc de proposta).
    output_config: { effort: "low" },
    // Cache do histórico: o último bloco vira ponto de cache a cada chamada.
    cache_control: { type: "ephemeral" },
    // Se o modelo recusar por política, a API tenta o modelo de reserva recomendado.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}

function somarUso(u: Uso, r: Anthropic.Beta.BetaMessage): Uso {
  return {
    entrada: u.entrada + (r.usage.input_tokens ?? 0),
    saida: u.saida + (r.usage.output_tokens ?? 0),
    cacheLeitura: u.cacheLeitura + (r.usage.cache_read_input_tokens ?? 0),
    cacheEscrita: u.cacheEscrita + (r.usage.cache_creation_input_tokens ?? 0),
  };
}

export async function executarTurno(args: {
  q: Questionario;
  historico: Anthropic.Beta.BetaMessageParam[];
  /** Texto do cliente ou aviso do app ("[Aviso do app] ..."). */
  entrada: string;
  estado: EstadoAgente;
  chamar: ChamarLLM;
}): Promise<ResultadoTurno> {
  const { q, chamar } = args;
  const mensagens: Anthropic.Beta.BetaMessageParam[] = [...args.historico, { role: "user", content: args.entrada }];
  let estado = args.estado;
  let alterou = false;
  const textos: string[] = [];
  const sinais: Sinal[] = [];
  let uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const resposta = await chamar(parametros(q, mensagens));
    uso = somarUso(uso, resposta);

    // Recusa da cadeia toda: não grava a fala parcial e devolve uma mensagem fixa.
    if (resposta.stop_reason === "refusal") {
      return { historico: mensagens, estado, alterou, textos, sinais, uso, fim: "recusa" };
    }

    mensagens.push({ role: "assistant", content: resposta.content as Anthropic.Beta.BetaContentBlockParam[] });
    for (const b of resposta.content) if (b.type === "text" && b.text.trim()) textos.push(b.text.trim());

    if (resposta.stop_reason === "pause_turn") continue;
    if (resposta.stop_reason === "max_tokens") return { historico: mensagens, estado, alterou, textos, sinais, uso, fim: "corte" };
    if (resposta.stop_reason !== "tool_use") return { historico: mensagens, estado, alterou, textos, sinais, uso, fim: "ok" };

    // Todas as ferramentas da resposta numa única mensagem de resultados.
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of resposta.content) {
      if (b.type !== "tool_use") continue;
      const r = executarFerramenta(q, b.name, b.input, estado);
      estado = r.estado;
      alterou ||= r.alterou;
      if (r.sinal) sinais.push(r.sinal);
      resultados.push({ type: "tool_result", tool_use_id: b.id, content: r.conteudo, is_error: r.erro });
    }
    mensagens.push({ role: "user", content: resultados });
  }
  return { historico: mensagens, estado, alterou, textos, sinais, uso, fim: "rodadas" };
}

/** Cliente da API com tempo e retentativas limitados (o SDK já repete 429 e 5xx). */
export function chamarAnthropic(apiKey: string): ChamarLLM {
  const cliente = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  return (params) => cliente.beta.messages.create(params);
}

export interface FalaTela {
  autor: "cliente" | "agente";
  texto: string;
}

/** Histórico para a tela: só textos do cliente e do agente (sem ferramentas, raciocínio e avisos do app). */
export function falasParaTela(historico: readonly unknown[]): FalaTela[] {
  const falas: FalaTela[] = [];
  for (const m of historico) {
    if (m === null || typeof m !== "object") continue;
    const { role, content } = m as { role?: unknown; content?: unknown };
    const blocos = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocos as { type?: unknown; text?: unknown }[]) {
      if (b?.type !== "text" || typeof b.text !== "string" || !b.text.trim()) continue;
      if (role === "user" && !b.text.startsWith("[Aviso do app]")) falas.push({ autor: "cliente", texto: b.text });
      if (role === "assistant") falas.push({ autor: "agente", texto: b.text.trim() });
    }
  }
  return falas;
}
