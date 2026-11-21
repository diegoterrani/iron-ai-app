import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  BETA_VINCULO_RACIOCINIO,
  MODELO_AGENTE,
  erroDeRaciocinio,
  type ChamarLLM,
  type Uso,
} from "@/lib/assessment/agente/conversa";
import type { AreaDeep, RoteiroDeep } from "@/lib/assessment/deep/roteiro";
import { definirFerramentasDeep, executarFerramentaDeep, type BancoDeep, type SinalDeep } from "./ferramentas";
import { janelaDeFalas, MAX_TEXTO_ESCUTA, type ContextoEscuta } from "./escuta";
import { mascararDadosSensiveis, type TipoMascara } from "./mascara";
import { montarPromptDeep } from "./prompt";

/**
 * Um turno do agente do Deep: a fala do analista entra (já mascarada), o
 * agente responde e pode chamar ferramentas (várias rodadas) até devolver
 * texto. Sem banco e sem rede aqui dentro: quem chama passa as falas da
 * reunião, o contexto, o acesso ao banco e a função que fala com a API.
 */

/** Chamadas à API por fala do analista (cada ferramenta usada abre outra). */
export const MAX_RODADAS_DEEP = 8;
/** Uma fala pode trazer várias respostas: cabe mais que no Self. */
export const MAX_TEXTO_ANALISTA = 4000;
const MAX_TOKENS_RESPOSTA = 8000;

/** Uma fala como fica em deep_mensagens. */
export interface FalaDeep {
  papel: "analista" | "agente";
  conteudo: string | Anthropic.Beta.BetaContentBlockParam[];
}

export interface ResultadoTurnoDeep {
  /** Falas novas deste turno, para acrescentar à reunião (nada antigo muda). */
  novas: FalaDeep[];
  textos: string[];
  sinais: SinalDeep[];
  uso: Uso;
  fim: "ok" | "recusa" | "rodadas" | "corte";
  mascarados: Record<TipoMascara, number>;
}

export class EntradaInvalida extends Error {}

export function paraMensagens(falas: readonly FalaDeep[]): Anthropic.Beta.BetaMessageParam[] {
  return falas.map((f) => ({ role: f.papel === "agente" ? "assistant" : "user", content: f.conteudo }));
}

/** Prompt fixo e ferramentas primeiro (cacheados); o contexto da reunião vem depois, fora do cache. */
export function parametrosDeep(
  roteiro: RoteiroDeep,
  contexto: string,
  mensagens: Anthropic.Beta.BetaMessageParam[],
  opcoes: { descartarRaciocinioInvalido?: boolean } = {},
): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const descartar = opcoes.descartarRaciocinioInvalido === true;
  return {
    model: MODELO_AGENTE,
    max_tokens: MAX_TOKENS_RESPOSTA,
    system: [
      { type: "text", text: montarPromptDeep(roteiro), cache_control: { type: "ephemeral" } },
      { type: "text", text: contexto },
    ],
    tools: definirFerramentasDeep(roteiro),
    messages: mensagens,
    output_config: { effort: "low" },
    cache_control: { type: "ephemeral" },
    betas: descartar ? ["server-side-fallback-2026-07-01", BETA_VINCULO_RACIOCINIO] : ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(descartar ? { thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } } } : {}),
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

export async function executarTurnoDeep(args: {
  roteiro: RoteiroDeep;
  area: AreaDeep;
  /** Falas da reunião atual, como vieram de deep_reservar_turno. */
  falas: readonly FalaDeep[];
  /** Texto digitado pelo analista, aviso do app ("[Aviso do app] ...") ou transcrição ("[Escuta] ..."). */
  entrada: string;
  contexto: string;
  banco: BancoDeep;
  chamar: ChamarLLM;
  /** Turno de escuta: transcrição como entrada, com as regras próprias das ferramentas. */
  escuta?: ContextoEscuta;
  /** Quantos turnos recentes da reunião vão ao modelo (o resto está no estado do Deep). Sem valor, todos. */
  janelaTurnos?: number;
}): Promise<ResultadoTurnoDeep> {
  const bruto = args.entrada.trim();
  const limite = args.escuta ? MAX_TEXTO_ESCUTA : MAX_TEXTO_ANALISTA;
  if (!bruto) throw new EntradaInvalida("fala vazia");
  if (bruto.length > limite) throw new EntradaInvalida(`fala acima de ${limite} caracteres`);
  const { texto, contagem } = mascararDadosSensiveis(bruto);

  const novas: FalaDeep[] = [{ papel: "analista", conteudo: texto }];
  const historico = args.janelaTurnos ? janelaDeFalas(args.falas, args.janelaTurnos) : args.falas;
  const mensagens = [...paraMensagens(historico), ...paraMensagens(novas)];
  const textos: string[] = [];
  const sinais: SinalDeep[] = [];
  let uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
  let descartar = false;
  const fechar = (fim: ResultadoTurnoDeep["fim"]): ResultadoTurnoDeep => ({ novas, textos, sinais, uso, fim, mascarados: contagem });
  const acrescentar = (f: FalaDeep) => {
    novas.push(f);
    mensagens.push(...paraMensagens([f]));
  };

  for (let rodada = 0; rodada < MAX_RODADAS_DEEP; rodada++) {
    let resposta: Anthropic.Beta.BetaMessage;
    try {
      resposta = await args.chamar(parametrosDeep(args.roteiro, args.contexto, mensagens, { descartarRaciocinioInvalido: descartar }));
    } catch (err) {
      // Uma única repetição, e só para o 400 de raciocínio; qualquer outro erro sobe.
      if (descartar || !erroDeRaciocinio(err)) throw err;
      descartar = true;
      resposta = await args.chamar(parametrosDeep(args.roteiro, args.contexto, mensagens, { descartarRaciocinioInvalido: true }));
    }
    uso = somarUso(uso, resposta);

    // Recusa: não grava a fala parcial do agente.
    if (resposta.stop_reason === "refusal") return fechar("recusa");

    acrescentar({ papel: "agente", conteudo: resposta.content as Anthropic.Beta.BetaContentBlockParam[] });
    for (const b of resposta.content) if (b.type === "text" && b.text.trim()) textos.push(b.text.trim());

    if (resposta.stop_reason === "pause_turn") continue;
    if (resposta.stop_reason === "max_tokens") return fechar("corte");
    if (resposta.stop_reason !== "tool_use") return fechar("ok");

    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of resposta.content) {
      if (b.type !== "tool_use") continue;
      const r = await executarFerramentaDeep(args.roteiro, args.area, b.name, b.input, args.banco, args.escuta);
      if (r.sinal) sinais.push(r.sinal);
      resultados.push({ type: "tool_result", tool_use_id: b.id, content: r.conteudo, is_error: r.erro });
    }
    acrescentar({ papel: "analista", conteudo: resultados });
  }
  return fechar("rodadas");
}
