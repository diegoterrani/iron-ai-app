import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { areasQ6, pendencias, type EmpresaSelf, type Questionario, type RespostasSelf } from "@/lib/assessment/questionario";
import { normalizarEmpresa, normalizarRascunho } from "@/lib/assessment/self";

/**
 * Ferramentas do agente do Self assessment.
 *
 * O agente só conversa e PROPÕE valores. Toda gravação passa pela mesma
 * validação do formulário (normalizarRascunho / normalizarEmpresa); valor
 * fora das listas volta como erro para o agente perguntar de novo. O agente
 * não acessa o banco, outros assessments nem o motor: os números do
 * resultado continuam saindo só do motor determinístico.
 *
 * CNPJ e telefone nunca passam pelo LLM (decisão de 03/11/2026): o agente
 * pede, e o app mostra um campo que grava direto no banco.
 */

export type CampoSeguro = "cnpj" | "contato_telefone";

export interface EstadoAgente {
  setor: string;
  respostas: RespostasSelf;
  empresa: EmpresaSelf;
}

export type Sinal = { tipo: "campo_seguro"; campo: CampoSeguro } | { tipo: "resumo" };

export interface ResultadoFerramenta {
  conteudo: string;
  erro: boolean;
  /** Estado depois da ferramenta (igual ao anterior se ela só leu ou falhou). */
  estado: EstadoAgente;
  /** O que a tela precisa fazer (mostrar um campo seguro ou o resumo). */
  sinal?: Sinal;
  /** true quando respostas ou empresa mudaram e precisam ser gravadas. */
  alterou: boolean;
}

const CAMPOS_EMPRESA_LLM = ["nome", "cidade", "uf", "contato_nome", "contato_cargo", "contato_email"] as const;
const CAMPOS_SEGUROS: readonly CampoSeguro[] = ["cnpj", "contato_telefone"];
/** Chaves que o agente pode registrar nas respostas (as mesmas do formulário). */
const CHAVES_RESPOSTAS = [
  "q2_valor", "q2", "q3", "q4", "unidades", "grade_q5", "pessoas_q6", "q7", "q8", "dados_D", "q9", "q10", "q11", "q12",
] as const;
/** Respostas que são mapas por área ou fonte: o agente manda só as chaves que mudam. */
const MAPAS = new Set(["grade_q5", "pessoas_q6", "dados_D"]);

const enumDe = (valores: readonly string[]) => ({ type: "string", enum: [...valores] });
const listaDe = (valores: readonly string[]) => ({ type: "array", items: enumDe(valores), uniqueItems: true });

/** Definições enviadas à API. Geradas do questionário, então mudam junto com o pacote. */
export function definirFerramentas(q: Questionario): Anthropic.Beta.BetaTool[] {
  const areas = q.areasQ5.map((a) => a.id);
  const fontes = q.dados.itens.map((i) => i.id);
  const unidade = {
    type: "object",
    additionalProperties: false,
    required: ["segmento"],
    properties: {
      segmento: enumDe(q.segmentos.map((s) => s.id)),
      quantidade: { type: "integer", minimum: 1 },
      participacao_receita: { type: "number", minimum: 0.1, maximum: 100, description: "% do faturamento deste tipo" },
      lugares_total: { type: "integer", minimum: 0, description: "só restaurantes" },
      ticket_pessoa: { ...enumDe(q.opcoes.ticket), description: "só restaurantes, em R$" },
      fila_pico: { ...enumDe(q.opcoes.fila), description: "só restaurantes" },
      refeicoes_dia: { type: "integer", minimum: 0, description: "só institucional" },
    },
  };
  const mapa = (chaves: string[], valor: object) => ({
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(chaves.map((c) => [c, valor])),
  });
  return [
    {
      name: "registrar_respostas",
      description:
        "Grava respostas do assessment já confirmadas pelo cliente. Mande só os campos que mudaram. " +
        "Mapas (grade_q5, pessoas_q6, dados_D) são mesclados por chave; listas (unidades, q8, q9, q12) substituem a anterior por inteiro. " +
        "Devolve as pendências atualizadas ou o erro de validação: nesse caso, pergunte de novo ao cliente, nunca invente.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["respostas"],
        properties: {
          respostas: {
            type: "object",
            additionalProperties: false,
            properties: {
              q2_valor: { type: "integer", minimum: 1, description: "faturamento anual em R$ (preferível)" },
              q2: { ...enumDe(q.opcoes.receita), description: "faixa de faturamento, só se o cliente não quiser dar o valor" },
              q3: enumDe(q.opcoes.pessoasTotal),
              q4: enumDe(q.opcoes.margem),
              unidades: { type: "array", maxItems: q.maxUnidades, items: unidade },
              grade_q5: mapa(areas, listaDe(q.opcoes.nivelQ5)),
              pessoas_q6: mapa(areas, enumDe(q.opcoes.pessoasArea)),
              q7: { type: "string", maxLength: 500 },
              q8: listaDe(q.opcoes.q8),
              dados_D: mapa(fontes, enumDe(q.opcoes.cobertura)),
              q9: listaDe(q.opcoes.q9),
              q10: enumDe(q.opcoes.q10),
              q11: enumDe(q.opcoes.q11),
              q12: listaDe(q.opcoes.q12),
            },
          },
        },
      },
    },
    {
      name: "registrar_empresa",
      description:
        "Grava o cadastro da empresa avaliada e do contato principal. Não aceita CNPJ nem telefone: para esses, use pedir_campo_seguro.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["empresa"],
        properties: {
          empresa: {
            type: "object",
            additionalProperties: false,
            properties: {
              nome: { type: "string", maxLength: 200 },
              cidade: { type: "string", maxLength: 100 },
              uf: { type: "string", enum: ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] },
              contato_nome: { type: "string", maxLength: 120 },
              contato_cargo: { type: "string", maxLength: 120 },
              contato_email: { type: "string", maxLength: 254 },
            },
          },
        },
      },
    },
    {
      name: "pedir_campo_seguro",
      description:
        "Mostra ao cliente um campo do app para digitar CNPJ ou telefone. O valor vai direto ao banco e você nunca o vê; " +
        "o app avisa quando o campo for preenchido.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["campo"],
        properties: { campo: enumDe(CAMPOS_SEGUROS) },
      },
    },
    {
      name: "ver_estado",
      description:
        "Mostra o que já foi registrado, as áreas que a pergunta 6 pede agora e as pendências para concluir. Use antes de decidir a próxima pergunta.",
      input_schema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "mostrar_resumo",
      description:
        "Quando não houver pendências, mostra ao cliente o resumo de tudo o que foi registrado para ele conferir e confirmar. " +
        "Se ainda houver pendência, devolve a lista.",
      input_schema: { type: "object", additionalProperties: false, properties: {} },
    },
  ];
}

const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Visão do estado para o agente: sem CNPJ e telefone, só se foram preenchidos. */
export function estadoParaAgente(q: Questionario, e: EstadoAgente) {
  const { cnpj, contato_telefone, ...empresa } = e.empresa;
  return {
    respostas: e.respostas,
    empresa: { ...empresa, cnpj_preenchido: Boolean(cnpj), telefone_preenchido: Boolean(contato_telefone) },
    areas_da_pergunta_6: areasQ6(q, e.respostas.grade_q5),
    pendencias: pendencias(q, e.respostas, e.empresa).map((p) => p.texto),
  };
}

function falha(estado: EstadoAgente, mensagem: string): ResultadoFerramenta {
  return { conteudo: mensagem, erro: true, estado, alterou: false };
}

/** Executa uma chamada de ferramenta do agente. Nunca lança: erro volta como tool_result de erro. */
export function executarFerramenta(q: Questionario, nome: string, entrada: unknown, estado: EstadoAgente): ResultadoFerramenta {
  const ok = (conteudo: unknown, novo = estado, extra: Partial<ResultadoFerramenta> = {}): ResultadoFerramenta => ({
    conteudo: JSON.stringify(conteudo),
    erro: false,
    estado: novo,
    alterou: novo !== estado,
    ...extra,
  });

  switch (nome) {
    case "registrar_respostas": {
      if (!objeto(entrada) || !objeto(entrada.respostas)) return falha(estado, "Formato inválido: envie {\"respostas\": {...}}.");
      const patch = entrada.respostas;
      const ignorados = Object.keys(patch).filter((k) => !(CHAVES_RESPOSTAS as readonly string[]).includes(k));
      const mesclado: Record<string, unknown> = { ...estado.respostas };
      for (const k of CHAVES_RESPOSTAS) {
        if (!Object.hasOwn(patch, k)) continue;
        const v = patch[k];
        mesclado[k] = MAPAS.has(k) && objeto(v) && objeto(mesclado[k]) ? { ...(mesclado[k] as object), ...v } : v;
      }
      // Faturamento: valor exato e faixa são excludentes; o último informado vale.
      if (Object.hasOwn(patch, "q2")) delete mesclado.q2_valor;
      const n = normalizarRascunho(mesclado, estado.setor);
      if (!n.ok) return falha(estado, `Não gravado: ${n.erro} Confirme com o cliente e tente de novo.`);
      const novo = { ...estado, respostas: n.respostas };
      const visao = estadoParaAgente(q, novo);
      return ok({
        gravado: true,
        ...(ignorados.length ? { campos_ignorados: ignorados } : {}),
        areas_da_pergunta_6: visao.areas_da_pergunta_6,
        pendencias: visao.pendencias,
      }, novo);
    }
    case "registrar_empresa": {
      if (!objeto(entrada) || !objeto(entrada.empresa)) return falha(estado, "Formato inválido: envie {\"empresa\": {...}}.");
      const recebido = entrada.empresa;
      if (CAMPOS_SEGUROS.some((c) => Object.hasOwn(recebido, c))) {
        return falha(estado, "CNPJ e telefone não são gravados por aqui. Use pedir_campo_seguro e não repita o número na conversa.");
      }
      const patch: Record<string, unknown> = {};
      for (const c of CAMPOS_EMPRESA_LLM) if (Object.hasOwn(recebido, c)) patch[c] = recebido[c];
      const n = normalizarEmpresa({ ...estado.empresa, ...patch });
      if (!n.ok) return falha(estado, `Não gravado: ${n.erro}`);
      const novo = { ...estado, empresa: n.empresa };
      return ok({ gravado: true, pendencias: estadoParaAgente(q, novo).pendencias }, novo);
    }
    case "pedir_campo_seguro": {
      const campo = objeto(entrada) ? entrada.campo : undefined;
      if (!CAMPOS_SEGUROS.includes(campo as CampoSeguro)) return falha(estado, "Campo inválido: use cnpj ou contato_telefone.");
      return ok({ mostrado: true, observacao: "Aguarde o aviso do app de que o campo foi preenchido." }, estado, {
        sinal: { tipo: "campo_seguro", campo: campo as CampoSeguro },
      });
    }
    case "ver_estado":
      return ok(estadoParaAgente(q, estado));
    case "mostrar_resumo": {
      const faltam = estadoParaAgente(q, estado).pendencias;
      if (faltam.length > 0) return falha(estado, `Ainda falta: ${faltam.join("; ")}.`);
      return ok({ mostrado: true, observacao: "O cliente vai conferir o resumo na tela e confirmar." }, estado, {
        sinal: { tipo: "resumo" },
      });
    }
    default:
      return falha(estado, `Ferramenta desconhecida: ${nome}.`);
  }
}
