import "server-only";
import { situacaoArea, type AreaDeep, type RespostaVigente, type RoteiroDeep } from "@/lib/assessment/deep/roteiro";

/**
 * Contexto que o modelo recebe a cada chamada: o estado estruturado do Deep
 * (o que já foi respondido e o que falta na área), os resumos das reuniões
 * anteriores e as falas da reunião atual. A transcrição de outras reuniões
 * nunca entra: o custo não cresce com o número de reuniões e o histórico
 * completo fica no banco.
 */

/** Formato devolvido por deep_estado (migração 20261120120000). */
export interface EstadoBanco {
  deep: { id: string; setor: string; pacote_versao: string; status: string; escopo: unknown };
  sessoes: {
    id: string;
    numero: number;
    area: string;
    titulo: string;
    status: string;
    participantes: { nome: string; cargo?: string }[];
    resumo: string | null;
    /** Migração 20261120200000; ausente em banco sem a escuta (vale desligada). */
    escuta_modo?: "desligada" | "fluido" | "pergunta" | "ambos";
    pergunta_marcada?: string | null;
  }[];
  respostas: {
    pergunta_id: string;
    area: string;
    valor: unknown;
    nao_se_aplica: boolean;
    confianca: string;
    participante: string | null;
    origem?: "digitacao" | "escuta";
  }[];
  a_confirmar?: { id: string; sessao_id: string; pergunta_id: string; area: string; valor: unknown; nao_se_aplica: boolean; motivo: string }[];
  evidencias: { criterio_id: string; area: string; tipo: string; fonte: string | null; descricao: string; cumprido: boolean | null }[];
  pendencias_abertas: { fonte: string | null; descricao: string; responsavel: string | null; prazo: string | null }[];
}

/** Quantas perguntas da fila vão ao modelo de cada vez (o resto ele vê pelo progresso). */
const PROXIMAS = 8;

export function respostasVigentes(e: EstadoBanco): Record<string, RespostaVigente> {
  return Object.fromEntries(e.respostas.map((r) => [r.pergunta_id, { valor: r.valor, nao_se_aplica: r.nao_se_aplica }]));
}

/** Estado resumido para o modelo (ver_estado e o bloco de contexto). Sem ids internos do banco. */
export function estadoParaModelo(roteiro: RoteiroDeep, e: EstadoBanco, sessaoId: string) {
  const atual = e.sessoes.find((s) => s.id === sessaoId);
  if (!atual) throw new Error("reunião não pertence a este Deep");
  const area = atual.area as AreaDeep;
  const respostas = respostasVigentes(e);
  const situacao = situacaoArea(roteiro, area, respostas);
  const progresso = Object.fromEntries(
    (["A", "B", "C", "transversal"] as const).map((a) => {
      const s = situacaoArea(roteiro, a, respostas);
      return [a, `${s.nucleoRespondidas}/${s.nucleoTotal} do núcleo`];
    }),
  );
  return {
    reuniao: { numero: atual.numero, area, titulo: atual.titulo, participantes: atual.participantes },
    progresso,
    proximas_da_area: situacao.fila.slice(0, PROXIMAS).map((p) => ({ id: p.id, nucleo: p.nucleo })),
    restantes_na_fila: Math.max(0, situacao.fila.length - PROXIMAS),
    aguardando_gatilho: situacao.aguardandoGatilho,
    respondidas: e.respostas.map((r) => ({
      id: r.pergunta_id,
      ...(r.nao_se_aplica ? { nao_se_aplica: true } : { valor: r.valor }),
      confianca: r.confianca,
    })),
    evidencias: e.evidencias.map((v) => ({ criterio: v.criterio_id, tipo: v.tipo, cumprido: v.cumprido })),
    pendencias_abertas: e.pendencias_abertas.map((p) => ({ fonte: p.fonte, descricao: p.descricao, responsavel: p.responsavel, prazo: p.prazo })),
    // Só aparece quando há algo esperando o analista (a escuta propôs e ele ainda não decidiu).
    ...(e.a_confirmar?.length
      ? {
          a_confirmar: e.a_confirmar.map((c) => ({
            id: c.pergunta_id,
            ...(c.nao_se_aplica ? { nao_se_aplica: true } : { valor: c.valor }),
            motivo: c.motivo,
          })),
        }
      : {}),
  };
}

/** Bloco de contexto da reunião (vai depois do prompt fixo, fora do cache). */
export function blocoContexto(roteiro: RoteiroDeep, e: EstadoBanco, sessaoId: string): string {
  const anteriores = e.sessoes
    .filter((s) => s.id !== sessaoId && s.status === "encerrada" && s.resumo)
    .map((s) => `## Reunião ${s.numero} (área ${s.area}): ${s.titulo}\n${s.resumo}`);
  return [
    "# Estado do Deep nesta reunião",
    JSON.stringify(estadoParaModelo(roteiro, e, sessaoId)),
    "# Resumos das reuniões anteriores",
    anteriores.length ? anteriores.join("\n\n") : "Nenhuma reunião anterior encerrada.",
  ].join("\n");
}
