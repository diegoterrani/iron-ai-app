import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { AREAS, validarValor, type AreaDeep, type RoteiroDeep, type ValorDeep } from "@/lib/assessment/deep/roteiro";

/**
 * Ferramentas do agente do Deep (modo analista).
 *
 * O agente não lê nem grava o banco: propõe respostas, e cada uma passa pela
 * validação do roteiro (pergunta existe, valor do tipo certo, faixa) antes de
 * ir para as funções do banco, que conferem a permissão do analista de novo.
 * Um lote com qualquer item inválido não grava nada: o erro volta ao modelo,
 * que pede confirmação ao analista em vez de supor.
 */

export const MAX_ITENS_LOTE = 50;
const MAX_TRECHO = 500;
const MAX_PARTICIPANTE = 200;
const CONFIANCAS = ["alta", "media", "baixa"] as const;
const TIPOS_EVIDENCIA = ["documento", "dado", "observacao", "declaracao"] as const;

export interface RespostaParaGravar {
  pergunta_id: string;
  area: AreaDeep;
  valor: ValorDeep | null;
  nao_se_aplica: boolean;
  participante?: string;
  confianca: (typeof CONFIANCAS)[number];
  trecho?: string;
}

export interface EvidenciaParaGravar {
  criterio_id: string;
  tipo: (typeof TIPOS_EVIDENCIA)[number];
  descricao: string;
  fonte?: string;
  cumprido?: boolean;
}

export interface PendenciaParaGravar {
  fonte?: string;
  descricao: string;
  responsavel?: string;
  prazo?: string;
}

/** O que o agente consegue fazer no banco, sempre na reunião aberta e com o analista da sessão. */
export interface BancoDeep {
  registrarRespostas(itens: RespostaParaGravar[]): Promise<{ gravadas: number; inalteradas: number }>;
  registrarEvidencias(itens: EvidenciaParaGravar[]): Promise<{ gravadas: number; inalteradas: number }>;
  registrarPendencia(p: PendenciaParaGravar): Promise<string>;
  /** Estado atual para ver_estado (já resumido para o modelo). */
  verEstado(): Promise<unknown>;
}

export type SinalDeep = { tipo: "resumo_reuniao"; resumo: string } | { tipo: "gravou"; respostas: number; evidencias: number; pendencias: number };

export interface ResultadoFerramentaDeep {
  conteudo: string;
  erro: boolean;
  sinal?: SinalDeep;
}

const texto = (max: number, extra: object = {}) => ({ type: "string", maxLength: max, ...extra });

/** Definições enviadas à API, geradas do roteiro (mudam junto com o pacote). */
export function definirFerramentasDeep(roteiro: RoteiroDeep): Anthropic.Beta.BetaTool[] {
  const ids = roteiro.perguntas.map((p) => p.id);
  const fontes = Object.keys(roteiro.fontes).sort();
  return [
    {
      name: "ver_estado",
      description:
        "Mostra o que já foi respondido no Deep inteiro, a fila de perguntas da área desta reunião (núcleo primeiro), " +
        "o que espera gatilho e as pendências abertas. Use no início da reunião e quando estiver em dúvida.",
      input_schema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "registrar_respostas",
      description:
        `Grava de uma vez todas as respostas contidas na fala do analista (até ${MAX_ITENS_LOTE}), inclusive de outras áreas. ` +
        "Cada item leva o trecho literal que o sustenta. Resposta igual à já gravada é ignorada; diferente substitui a anterior (que fica no histórico). " +
        "Se a pergunta não se aplica, mande nao_se_aplica true, sem valor, e o motivo no trecho. " +
        "Se algum item for inválido, nada é gravado e o erro diz qual: confirme com o analista e mande de novo.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["respostas"],
        properties: {
          respostas: {
            type: "array",
            minItems: 1,
            maxItems: MAX_ITENS_LOTE,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["pergunta_id", "confianca", "trecho"],
              properties: {
                pergunta_id: { type: "string", enum: ids },
                valor: { description: "No tipo da pergunta: texto, número, true/false, opção ou lista de opções." },
                nao_se_aplica: { type: "boolean" },
                participante: texto(MAX_PARTICIPANTE, { description: "nome ou cargo de quem respondeu, se o analista disse" }),
                confianca: { type: "string", enum: [...CONFIANCAS], description: "alta: lido de relatório ou sistema; media: de cabeça com segurança; baixa: estimativa" },
                trecho: texto(MAX_TRECHO, { description: "trecho literal da fala do analista que sustenta a resposta" }),
              },
            },
          },
        },
      },
    },
    {
      name: "registrar_evidencias",
      description:
        "Registra a prova de um critério (gate da área ou régua): tipo da prova, descrição, fonte de dados e se o critério está cumprido. " +
        "Um veredito vigente por critério; mandar de novo substitui.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["evidencias"],
        properties: {
          evidencias: {
            type: "array",
            minItems: 1,
            maxItems: MAX_ITENS_LOTE,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["criterio_id", "tipo", "descricao"],
              properties: {
                criterio_id: { type: "string", enum: roteiro.criteriosGate },
                tipo: { type: "string", enum: [...TIPOS_EVIDENCIA] },
                descricao: texto(2000),
                fonte: { type: "string", enum: fontes },
                cumprido: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    {
      name: "registrar_pendencia",
      description: "Anota um dado ou documento que a empresa ficou de enviar (fontes F01 a F20), com responsável e prazo se ditos.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["descricao"],
        properties: {
          fonte: { type: "string", enum: fontes },
          descricao: texto(1000),
          responsavel: texto(MAX_PARTICIPANTE),
          prazo: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "AAAA-MM-DD" },
        },
      },
    },
    {
      name: "encerrar_reuniao",
      description:
        "Propõe o resumo da reunião para o analista revisar antes de encerrar: o que foi respondido, o que ficou pendente e o que confirmar. " +
        "Só chame quando o analista pedir para encerrar. Não encerra sozinho: o analista confirma na tela.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["resumo"],
        properties: { resumo: texto(20000, { minLength: 20 }) },
      },
    },
  ];
}

const ok = (conteudo: unknown, sinal?: SinalDeep): ResultadoFerramentaDeep => ({ conteudo: JSON.stringify(conteudo), erro: false, sinal });
const falha = (erros: string[] | string): ResultadoFerramentaDeep => ({
  conteudo: JSON.stringify({ erro: Array.isArray(erros) ? erros : [erros], gravado: false }),
  erro: true,
});
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const textoOpcional = (v: unknown, max: number): string | undefined | false => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > max) return false;
  return v.trim() || undefined;
};

/** Confere o lote de respostas inteiro; devolve os itens prontos ou a lista de erros. */
export function validarLoteRespostas(roteiro: RoteiroDeep, entrada: unknown): { itens: RespostaParaGravar[] } | { erros: string[] } {
  if (!obj(entrada) || !Array.isArray(entrada.respostas)) return { erros: ["respostas deve ser uma lista"] };
  const lista = entrada.respostas;
  if (lista.length < 1 || lista.length > MAX_ITENS_LOTE) return { erros: [`mande de 1 a ${MAX_ITENS_LOTE} respostas`] };

  const erros: string[] = [];
  const itens: RespostaParaGravar[] = [];
  const vistos = new Set<string>();
  lista.forEach((bruto, i) => {
    const onde = `item ${i + 1}`;
    if (!obj(bruto)) return void erros.push(`${onde}: formato inválido`);
    const permitidas = new Set(["pergunta_id", "valor", "nao_se_aplica", "participante", "confianca", "trecho"]);
    const extra = Object.keys(bruto).filter((k) => !permitidas.has(k));
    if (extra.length) return void erros.push(`${onde}: campos desconhecidos ${extra.join(", ")}`);
    const p = typeof bruto.pergunta_id === "string" ? roteiro.porId.get(bruto.pergunta_id) : undefined;
    if (!p) return void erros.push(`${onde}: pergunta inexistente no roteiro`);
    if (vistos.has(p.id)) return void erros.push(`${p.id}: repetida no lote`);
    vistos.add(p.id);
    if (!CONFIANCAS.includes(bruto.confianca as never)) return void erros.push(`${p.id}: confiança deve ser alta, media ou baixa`);
    const trecho = textoOpcional(bruto.trecho, MAX_TRECHO);
    const participante = textoOpcional(bruto.participante, MAX_PARTICIPANTE);
    if (trecho === false || participante === false) return void erros.push(`${p.id}: trecho ou participante longo demais`);
    if (!trecho) return void erros.push(`${p.id}: falta o trecho que sustenta a resposta`);

    const nsa = bruto.nao_se_aplica === true;
    let valor: ValorDeep | null = null;
    if (!nsa) {
      const v = validarValor(p, bruto.valor);
      if (!v.ok) return void erros.push(v.erro);
      valor = v.valor;
    }
    itens.push({
      pergunta_id: p.id,
      area: p.area,
      valor,
      nao_se_aplica: nsa,
      participante,
      confianca: bruto.confianca as RespostaParaGravar["confianca"],
      trecho,
    });
  });
  return erros.length ? { erros } : { itens };
}

function validarLoteEvidencias(roteiro: RoteiroDeep, entrada: unknown): { itens: EvidenciaParaGravar[] } | { erros: string[] } {
  if (!obj(entrada) || !Array.isArray(entrada.evidencias)) return { erros: ["evidencias deve ser uma lista"] };
  const lista = entrada.evidencias;
  if (lista.length < 1 || lista.length > MAX_ITENS_LOTE) return { erros: [`mande de 1 a ${MAX_ITENS_LOTE} evidências`] };
  const erros: string[] = [];
  const itens: EvidenciaParaGravar[] = [];
  const vistos = new Set<string>();
  lista.forEach((e, i) => {
    const onde = `item ${i + 1}`;
    if (!obj(e) || typeof e.criterio_id !== "string" || !roteiro.criteriosGate.includes(e.criterio_id)) {
      return void erros.push(`${onde}: critério inexistente`);
    }
    if (vistos.has(e.criterio_id)) return void erros.push(`${e.criterio_id}: repetido no lote`);
    vistos.add(e.criterio_id);
    if (!TIPOS_EVIDENCIA.includes(e.tipo as never)) return void erros.push(`${e.criterio_id}: tipo inválido`);
    const descricao = textoOpcional(e.descricao, 2000);
    if (!descricao) return void erros.push(`${e.criterio_id}: descrição obrigatória (até 2000 caracteres)`);
    if (e.fonte !== undefined && (typeof e.fonte !== "string" || !roteiro.fontes[e.fonte])) return void erros.push(`${e.criterio_id}: fonte inválida`);
    if (e.cumprido !== undefined && typeof e.cumprido !== "boolean") return void erros.push(`${e.criterio_id}: cumprido deve ser true ou false`);
    itens.push({
      criterio_id: e.criterio_id,
      tipo: e.tipo as EvidenciaParaGravar["tipo"],
      descricao,
      fonte: e.fonte as string | undefined,
      cumprido: e.cumprido as boolean | undefined,
    });
  });
  return erros.length ? { erros } : { itens };
}

function validarPendencia(roteiro: RoteiroDeep, e: unknown): { item: PendenciaParaGravar } | { erros: string[] } {
  if (!obj(e)) return { erros: ["formato inválido"] };
  const descricao = textoOpcional(e.descricao, 1000);
  const responsavel = textoOpcional(e.responsavel, MAX_PARTICIPANTE);
  if (!descricao) return { erros: ["descrição obrigatória (até 1000 caracteres)"] };
  if (responsavel === false) return { erros: ["responsável longo demais"] };
  if (e.fonte !== undefined && (typeof e.fonte !== "string" || !roteiro.fontes[e.fonte])) return { erros: ["fonte inválida"] };
  if (e.prazo !== undefined) {
    const d = typeof e.prazo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.prazo) ? new Date(`${e.prazo}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== e.prazo) return { erros: ["prazo deve ser uma data AAAA-MM-DD"] };
  }
  return { item: { fonte: e.fonte as string | undefined, descricao, responsavel, prazo: e.prazo as string | undefined } };
}

/**
 * Executa uma ferramenta pedida pelo modelo. Erro de validação volta como
 * resultado de ferramenta (o modelo corrige); erro do banco sobe para quem
 * chamou, que encerra o turno sem gravar falas de um estado incerto.
 */
export async function executarFerramentaDeep(
  roteiro: RoteiroDeep,
  area: AreaDeep,
  nome: string,
  entrada: unknown,
  banco: BancoDeep,
): Promise<ResultadoFerramentaDeep> {
  if (!AREAS.includes(area)) return falha("área da reunião inválida");
  switch (nome) {
    case "ver_estado":
      return ok(await banco.verEstado());
    case "registrar_respostas": {
      const v = validarLoteRespostas(roteiro, entrada);
      if ("erros" in v) return falha(v.erros);
      const r = await banco.registrarRespostas(v.itens);
      return ok({ ...r, estado: await banco.verEstado() }, { tipo: "gravou", respostas: r.gravadas, evidencias: 0, pendencias: 0 });
    }
    case "registrar_evidencias": {
      const v = validarLoteEvidencias(roteiro, entrada);
      if ("erros" in v) return falha(v.erros);
      const r = await banco.registrarEvidencias(v.itens);
      return ok(r, { tipo: "gravou", respostas: 0, evidencias: r.gravadas, pendencias: 0 });
    }
    case "registrar_pendencia": {
      const v = validarPendencia(roteiro, entrada);
      if ("erros" in v) return falha(v.erros);
      await banco.registrarPendencia(v.item);
      return ok({ registrada: true }, { tipo: "gravou", respostas: 0, evidencias: 0, pendencias: 1 });
    }
    case "encerrar_reuniao": {
      const resumo = obj(entrada) ? textoOpcional(entrada.resumo, 20000) : undefined;
      if (!resumo || resumo.length < 20) return falha("resumo obrigatório (20 a 20000 caracteres)");
      return ok({ mostrado_ao_analista: true }, { tipo: "resumo_reuniao", resumo });
    }
    default:
      return falha(`ferramenta desconhecida: ${nome}`);
  }
}
