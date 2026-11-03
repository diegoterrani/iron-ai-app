import "server-only";
import { z } from "zod";
import pacoteJson from "./dados/food_service.json";
import modeloJson from "./dados/modelo_comum.json";
import { MAX_UNIDADES, candidatasQ6, pesosQ6 } from "./motor";
import {
  OPCOES_MARGEM,
  OPCOES_OBJETIVO,
  Q7_MAX,
  areasQ6,
  paraEscolhaMultipla,
  pendencias,
  UFS,
  type CampoUnidade,
  type EmpresaSelf,
  type Orientacao,
  type SegmentoSelf,
  type UnidadeSelf,
  type Questionario,
  type RespostasGravadas,
  type RespostasSelf,
} from "./questionario";
import type { Modelo, Pacote } from "./tipos";

/**
 * Self assessment no servidor: monta o questionário a partir do modelo e do
 * pacote do setor e valida as respostas. A validação aqui é de FORMA (opções
 * da lista, números em faixa, tamanho); a coerência de negócio é do motor.
 */

export const modelo = modeloJson as unknown as Modelo;
export const pacote = pacoteJson as unknown as Pacote;
export const SETORES = ["food_service"] as const;

const chaves = (t: Record<string, unknown>) => Object.keys(t) as [string, ...string[]];

interface PerguntaSetorial {
  texto: string;
  orientacao?: Orientacao;
}

const CAMPOS_UNIDADE: readonly CampoUnidade[] = ["lugares_total", "ticket_pessoa", "fila_pico", "refeicoes_dia"];

/** Segmentos do pacote liberados no Self (0.4.0), na ordem do pacote. */
function segmentosSelf(): SegmentoSelf[] {
  return Object.entries(pacote.segmentos)
    .filter(([, v]) => v.no_self === true)
    .map(([id, v]) => {
      const campos = (v.campos_self ?? []) as CampoUnidade[];
      // Pacote com campo que a tela e a validação não conhecem é erro de pacote: falha cedo.
      for (const c of campos) if (!CAMPOS_UNIDADE.includes(c)) throw new Error(`campo de unidade desconhecido no pacote: ${c}`);
      return { id, nome: v.nome ?? id, abrange: v.abrange ?? "", campos };
    });
}

export function montarQuestionario(): Questionario {
  const s = modelo.self;
  const pu = (pacote as unknown as { perguntas_unidades: Record<"U1" | "I1", PerguntaSetorial> }).perguntas_unidades;
  const ps = pacote.perguntas_self as Record<string, PerguntaSetorial>;
  const dist = pacote.areas.distribuicao_tipica_pessoas;
  const peso = (a: string) => (typeof dist[a] === "number" ? (dist[a] as number) : 0);
  // Pergunta 5: áreas que mais pesam no setor primeiro (regra do framework).
  const areasQ5 = candidatasQ6(modelo)
    .map((id, i) => ({ id, i }))
    .sort((a, b) => peso(b.id) - peso(a.id) || a.i - b.i)
    .map(({ id }) => ({ id, nome: modelo.areas[id] ?? id }));
  const setorial = (k: string) => ({ texto: ps[k].texto, orientacao: ps[k].orientacao ?? {} });

  return {
    setor: pacote.pacote,
    versaoPacote: pacote.versao,
    opcoes: {
      receita: chaves(s.faixas_receita),
      pessoasTotal: chaves(s.faixas_pessoas_total),
      pessoasArea: chaves(s.faixas_pessoas_area),
      margem: OPCOES_MARGEM,
      ticket: chaves(s.faixas_ticket),
      fila: (ps.S3 as unknown as { opcoes: string[] }).opcoes,
      nivelQ5: chaves(s.nota_q5),
      q8: chaves(s.nota_q8),
      q9: chaves(s.nota_q9),
      q10: chaves(s.nota_q10),
      q11: chaves(s.nota_q11),
      q12: OPCOES_OBJETIVO,
      cobertura: chaves(s.cobertura_fonte),
    },
    areasQ5,
    q6: {
      candidatas: candidatasQ6(modelo),
      pesos: pesosQ6(pacote, modelo),
      notaQ5: s.nota_q5,
      quantidade: s.areas_no_calculo,
    },
    setoriais: { S1: setorial("S1"), S2: setorial("S2"), S3: setorial("S3") },
    dados: {
      texto: pacote.pergunta_dados_D.texto,
      itens: pacote.pergunta_dados_D.itens.map((id) => ({ id, nome: pacote.catalogo_fontes[id]?.nome ?? id })),
    },
    segmentos: segmentosSelf(),
    unidades: {
      U1: { texto: pu.U1.texto, orientacao: pu.U1.orientacao ?? {} },
      I1: { texto: pu.I1.texto, orientacao: pu.I1.orientacao ?? {} },
    },
    maxUnidades: MAX_UNIDADES,
  };
}

// ------------------------------------------------------------- validação

const q = montarQuestionario();
const enumDe = (valores: string[], msg: string) => z.enum(valores as [string, ...string[]], { error: msg });
/**
 * Escolha múltipla: aceita texto (rascunho antigo) ou lista; grava a lista
 * sem repetição e na ordem das opções, para o hash não depender da ordem em
 * que a pessoa clicou. Lista vazia vira "sem resposta".
 */
const multipla = (valores: string[], msg: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? [v] : v),
    z
      .array(enumDe(valores, msg), { error: msg })
      .max(valores.length, msg)
      .transform((l) => {
        const marcadas = new Set(l);
        const ordenada = valores.filter((o) => marcadas.has(o));
        return ordenada.length > 0 ? ordenada : undefined;
      }),
  );
const areasQ5Ids = q.areasQ5.map((a) => a.id) as [string, ...string[]];
const itensD = q.dados.itens.map((i) => i.id) as [string, ...string[]];

const segmentoIds = q.segmentos.map((s) => s.id) as [string, ...string[]];
const camposDoSegmento = new Map(q.segmentos.map((s) => [s.id, s.campos]));

/**
 * Um tipo de unidade no rascunho. Campos que não pertencem ao segmento são
 * descartados (ex.: lugares numa cozinha institucional), para o motor e o
 * hash verem só o que vale para aquele tipo.
 */
const unidadeSchema = z
  .object({
    segmento: z.enum(segmentoIds, { error: "Tipo de operação inválido." }),
    quantidade: z.number().int("Use um número inteiro.").min(1, "Mínimo de 1 unidade.").max(100000).optional(),
    participacao_receita: z
      .number({ error: "Participação inválida." })
      .gt(0, "Use um valor acima de 0%.")
      .max(100, "Use no máximo 100%.")
      .optional(),
    lugares_total: z.number().int().min(0).max(1000000, "Número de lugares alto demais.").optional(),
    ticket_pessoa: enumDe(q.opcoes.ticket, "Ticket inválido.").optional(),
    fila_pico: enumDe(q.opcoes.fila, "Resposta inválida.").optional(),
    refeicoes_dia: z.number().int().min(0).max(10000000, "Número de refeições alto demais.").optional(),
  })
  .transform((u) => {
    const campos = camposDoSegmento.get(u.segmento) ?? [];
    const out: Record<string, unknown> = { segmento: u.segmento };
    if (u.quantidade !== undefined) out.quantidade = u.quantidade;
    // Uma casa decimal basta e evita ruído de ponto flutuante no hash.
    if (u.participacao_receita !== undefined) out.participacao_receita = Math.round(u.participacao_receita * 10) / 10;
    for (const c of campos) if (u[c] !== undefined) out[c] = u[c];
    return out as unknown as UnidadeSelf;
  });

/**
 * Rascunho: tudo opcional, mas cada valor presente precisa ser válido.
 * Campos desconhecidos são descartados (zod remove chaves extras).
 */
export const rascunhoSchema = z.object({
  q2_valor: z
    .number({ error: "Faturamento inválido." })
    .int("Use um valor inteiro em reais.")
    .positive("O faturamento precisa ser positivo.")
    .max(1e12, "Valor alto demais.")
    .nullable()
    .optional(),
  q2: enumDe(q.opcoes.receita, "Faixa de faturamento inválida.").optional(),
  q3: enumDe(q.opcoes.pessoasTotal, "Faixa de pessoas inválida.").optional(),
  q4: enumDe(q.opcoes.margem, "Faixa de margem inválida.").optional(),
  setoriais: z
    .object({
      unidades: z.number().int().min(1, "Mínimo de 1 unidade.").max(100000).optional(),
      lugares_total: z.number().int().min(0).max(1000000, "Número de lugares alto demais.").optional(),
      ticket_pessoa: enumDe(q.opcoes.ticket, "Ticket inválido.").optional(),
      fila_pico: enumDe(q.opcoes.fila, "Resposta inválida.").optional(),
    })
    .optional(),
  unidades: z
    .array(unidadeSchema, { error: "Tipos de operação inválidos." })
    .max(q.maxUnidades, `No máximo ${q.maxUnidades} tipos de operação.`)
    .refine((l) => new Set(l.map((u) => u.segmento)).size === l.length, "Cada tipo de operação aparece uma vez só.")
    .optional(),
  grade_q5: z.partialRecord(z.enum(areasQ5Ids), multipla(q.opcoes.nivelQ5, "Resposta inválida.")).optional(),
  pessoas_q6: z.partialRecord(z.enum(areasQ5Ids), enumDe(q.opcoes.pessoasArea, "Faixa inválida.")).optional(),
  q7: z.string().trim().max(Q7_MAX, `Use até ${Q7_MAX} caracteres.`).optional(),
  q8: multipla(q.opcoes.q8, "Resposta inválida.").optional(),
  dados_D: z.partialRecord(z.enum(itensD), enumDe(q.opcoes.cobertura, "Resposta inválida.")).optional(),
  q9: multipla(q.opcoes.q9, "Resposta inválida.").optional(),
  q10: enumDe(q.opcoes.q10, "Resposta inválida.").optional(),
  q11: enumDe(q.opcoes.q11, "Resposta inválida.").optional(),
  q12: multipla(q.opcoes.q12, "Resposta inválida.").optional(),
});

/** Remove opcionais vazios para gravar um JSON enxuto e estável (o hash depende dele). */
function limpar<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "") continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const interno = limpar(v as Record<string, unknown>);
      if (Object.keys(interno).length > 0) out[k] = interno;
      continue;
    }
    out[k] = v;
  }
  return out as T;
}

/**
 * Normaliza um rascunho vindo da tela: valida, descarta o resto, grava o
 * setor do assessment (nunca o que o cliente mandou) e mantém na pergunta 6
 * só as áreas que ela pede agora.
 */
export function normalizarRascunho(
  entrada: unknown,
  setor: string,
): { ok: true; respostas: RespostasSelf } | { ok: false; erro: string } {
  const r = rascunhoSchema.safeParse(entrada);
  if (!r.success) return { ok: false, erro: r.error.issues[0]?.message ?? "Resposta inválida." };
  const dados = limpar({ ...r.data, setor }) as RespostasSelf;
  // Valor exato e faixa são excludentes: o exato tem precedência.
  if (dados.q2_valor !== undefined && dados.q2_valor !== null) delete dados.q2;
  if (dados.q2_valor === null) delete dados.q2_valor;
  // 0.4.0: com tipos de unidade, as perguntas S1 a S3 não entram mais no cálculo.
  if (dados.unidades !== undefined) delete dados.setoriais;
  if (dados.unidades?.length === 0) delete dados.unidades;
  const areas = areasQ6(q, dados.grade_q5);
  if (dados.pessoas_q6) {
    for (const a of Object.keys(dados.pessoas_q6)) if (!areas.includes(a)) delete dados.pessoas_q6[a];
    if (Object.keys(dados.pessoas_q6).length === 0) delete dados.pessoas_q6;
  }
  return { ok: true, respostas: dados };
}

/** Pronto para concluir? Mesma regra que a tela mostra na revisão. */
export function faltasParaConcluir(r: RespostasGravadas, e: EmpresaSelf): string[] {
  return pendencias(q, paraEscolhaMultipla(r), e).map((p) => p.texto);
}

// ------------------------------------------------------------- cadastro da empresa

const textoCurto = (max: number) => z.string().trim().max(max, `Use até ${max} caracteres.`).optional();

/** Rascunho do cadastro: tudo opcional; a completude (CNPJ válido, e-mail) é checada ao concluir. */
export const empresaSchema = z.object({
  nome: textoCurto(200),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.string().max(14, "CNPJ com dígitos demais."))
    .optional(),
  cidade: textoCurto(100),
  uf: z.enum(UFS, { error: "UF inválida." }).optional(),
  contato_nome: textoCurto(120),
  contato_cargo: textoCurto(120),
  contato_email: z.string().trim().toLowerCase().max(254, "E-mail longo demais.").optional(),
  contato_telefone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.string().max(13, "Telefone com dígitos demais."))
    .optional(),
});

export function normalizarEmpresa(entrada: unknown): { ok: true; empresa: EmpresaSelf } | { ok: false; erro: string } {
  const r = empresaSchema.safeParse(entrada ?? {});
  if (!r.success) return { ok: false, erro: r.error.issues[0]?.message ?? "Cadastro inválido." };
  return { ok: true, empresa: limpar(r.data) as EmpresaSelf };
}

// ------------------------------------------------------------- rótulos do resultado

export const ROTULO_DIMENSAO: Record<string, string> = {
  estrategia: "Estratégia",
  dados: "Dados",
  processos: "Processos",
  tecnologia: "Tecnologia",
  governanca: "Governança",
  pessoas: "Pessoas e cultura",
};

/** Nome legível de uma área (06_operacoes) ou alavanca (L_cmv) do resultado. */
export function nomeOrigem(origem: string): string {
  if (Object.hasOwn(modelo.areas, origem)) return modelo.areas[origem];
  if (Object.hasOwn(pacote.alavancas, origem)) return pacote.alavancas[origem].nome;
  return origem;
}
