import "server-only";
import { z } from "zod";
import { modelo } from "../self";
import pacoteJson from "./food_service.json";
import { aprofundar06 } from "./motor";
import { divisaoFecha, pendencias06, type Empresa06, type Questionario06, type Rascunho06 } from "./questionario";
import { FORMATO_06, NAO_SEI, type Pacote06, type Respostas06 } from "./tipos";

/**
 * Self 0.6 no servidor: monta o questionário (só textos e opções, sem taxas)
 * e valida a FORMA das respostas. A coerência de negócio fica no motor.
 */

export const pacote06 = pacoteJson as unknown as Pacote06;

const chaves = (t: Record<string, unknown>) => Object.keys(t);

export function montarQuestionario06(): Questionario06 {
  const p = pacote06;
  return {
    setor: p.pacote,
    versaoPacote: p.versao,
    segmentos: p.segmentos,
    custoPrincipal: p.custo_principal,
    linhasVermelhas: p.linhas_vermelhas.map(({ id, nome }) => ({ id, nome })),
    dores: p.dores.map(({ id, nome }) => ({ id, nome })),
    aprofundarMax: p.aprofundar_max,
    perguntas: Object.entries(p.perguntas).map(([id, q]) => ({ id, alavanca: q.alavanca, texto: q.texto, opcoes: q.opcoes.map((o) => o.texto) })),
    opcoes: {
      receita: chaves(modelo.self.faixas_receita),
      pessoas: chaves(modelo.self.faixas_pessoas_total),
      folha: [...chaves(p.faixas.folha), NAO_SEI],
      custo: [...chaves(p.faixas.custo), NAO_SEI],
      margem: [...chaves(p.faixas.margem), NAO_SEI],
      contratacoes: [...chaves(p.faixas.contratacoes), NAO_SEI],
      usoIa: chaves(p.prontidao.uso_ia),
      politica: chaves(p.prontidao.politica),
      patrocinio: chaves(p.prontidao.patrocinio),
    },
  };
}

const q = montarQuestionario06();
const enumDe = (valores: string[], msg: string) => z.enum(valores as [string, ...string[]], { error: msg });
const segIds = q.segmentos.map((s) => s.id) as [string, ...string[]];
const lvIds = q.linhasVermelhas.map((l) => l.id) as [string, ...string[]];
const perguntaIds = q.perguntas.map((p) => p.id) as [string, ...string[]];
const opcoesPergunta = new Map(q.perguntas.map((p) => [p.id, p.opcoes]));
const pctExato = (min: number) => z.number({ error: "Percentual inválido." }).min(min, "Percentual baixo demais.").max(95, "Percentual alto demais.");

/** Rascunho 0.6: tudo opcional, mas cada valor presente precisa ser válido. Chaves extras são descartadas. */
export const rascunho06Schema = z.object({
  linhas_vermelhas: z
    .array(z.enum(lvIds, { error: "Opção inválida." }))
    .max(lvIds.length)
    .transform((l) => {
      const marcadas = new Set(l);
      // "Nada específico" não convive com outras marcações.
      if (marcadas.size > 1) marcadas.delete("nenhuma");
      return lvIds.filter((id) => marcadas.has(id));
    })
    .optional(),
  linhas_vermelhas_outro: z.string().trim().max(200, "Use até 200 caracteres.").optional(),
  receita_valor: z.number({ error: "Faturamento inválido." }).int("Use um valor inteiro em reais.").positive().max(1e12).optional(),
  receita_faixa: enumDe(q.opcoes.receita, "Faixa de faturamento inválida.").optional(),
  pessoas: enumDe(q.opcoes.pessoas, "Faixa de pessoas inválida.").optional(),
  divisao: z
    .partialRecord(z.enum(segIds), z.number({ error: "Percentual inválido." }).min(0).max(100))
    .transform((d) => {
      // Uma casa decimal; segmento com 0% sai (o motor trata ausente como 0).
      const out: Record<string, number> = {};
      for (const id of segIds) if (d[id] !== undefined && d[id] > 0) out[id] = Math.round(d[id] * 10) / 10;
      return out;
    })
    .optional(),
  folha: enumDe(q.opcoes.folha, "Faixa de folha inválida.").optional(),
  folha_exata: pctExato(1).optional(),
  custo: enumDe(q.opcoes.custo, "Faixa de insumos inválida.").optional(),
  custo_exato: pctExato(1).optional(),
  contratacoes: enumDe(q.opcoes.contratacoes, "Faixa de contratações inválida.").optional(),
  margem: enumDe(q.opcoes.margem, "Faixa de margem inválida.").optional(),
  margem_exata: pctExato(-50).optional(),
  dor: z.enum(q.dores.map((d) => d.id) as [string, ...string[]], { error: "Opção inválida." }).optional(),
  nucleo: z
    .partialRecord(z.enum(perguntaIds), z.string())
    .superRefine((m, ctx) => {
      for (const [id, v] of Object.entries(m)) {
        if (v !== undefined && !opcoesPergunta.get(id)?.includes(v)) ctx.addIssue({ code: "custom", message: `Resposta inválida para "${id}".` });
      }
    })
    .optional(),
  uso_ia: enumDe(q.opcoes.usoIa, "Resposta inválida.").optional(),
  politica: enumDe(q.opcoes.politica, "Resposta inválida.").optional(),
  patrocinio: enumDe(q.opcoes.patrocinio, "Resposta inválida.").optional(),
});

/** Remove opcionais vazios: o JSON gravado fica enxuto e o hash, estável. */
function limpar(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const interno = limpar(v as Record<string, unknown>);
      if (Object.keys(interno).length > 0) out[k] = interno;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Valida o rascunho e grava formato e setor pelo servidor (nunca o que o
 * cliente mandou). Faixa e valor exato são excludentes: o exato vence.
 */
export function normalizarRascunho06(entrada: unknown, setor: string): { ok: true; respostas: Rascunho06 } | { ok: false; erro: string } {
  const r = rascunho06Schema.safeParse(entrada ?? {});
  if (!r.success) return { ok: false, erro: r.error.issues[0]?.message ?? "Resposta inválida." };
  const d = limpar(r.data as Record<string, unknown>) as Rascunho06;
  if (d.receita_valor !== undefined) delete d.receita_faixa;
  if (d.folha_exata !== undefined) delete d.folha;
  if (d.custo_exato !== undefined) delete d.custo;
  if (d.margem_exata !== undefined) delete d.margem;
  return { ok: true, respostas: { ...d, formato: FORMATO_06, setor } };
}

export function faltasParaConcluir06(r: Rascunho06, e: Empresa06): string[] {
  return pendencias06(r, e);
}

/** Perguntas de aprofundamento que o agente deve fazer agora (as já respondidas também vêm). */
export function aprofundar(r: Rascunho06): string[] {
  return aprofundar06({ formato: FORMATO_06, setor: pacote06.pacote, ...r } as Respostas06, pacote06, modelo);
}

/**
 * Perguntas de aprofundamento para o indicador de progresso. null enquanto o
 * retrato econômico estiver incompleto: o motor ainda não sabe quais linhas
 * valem mais, e a tela reserva o máximo do pacote.
 */
export function aprofundamentoParaProgresso(r: Rascunho06): string[] | null {
  const retratoCompleto =
    (r.receita_valor !== undefined || r.receita_faixa !== undefined) &&
    !!r.pessoas &&
    !!r.divisao &&
    divisaoFecha(r.divisao) &&
    (r.folha !== undefined || r.folha_exata !== undefined) &&
    (r.custo !== undefined || r.custo_exato !== undefined) &&
    (r.margem !== undefined || r.margem_exata !== undefined) &&
    !!r.contratacoes;
  return retratoCompleto ? aprofundar(r) : null;
}

/**
 * Rascunho é do formato 0.6? Novo (vazio) ou marcado. Rascunhos 0.5 já
 * começados seguem no formato antigo até concluir.
 */
export function eFormato06(respostas: unknown): boolean {
  if (respostas === null || typeof respostas !== "object") return true;
  const r = respostas as Record<string, unknown>;
  return r.formato === FORMATO_06 || Object.keys(r).filter((k) => k !== "setor").length === 0;
}
