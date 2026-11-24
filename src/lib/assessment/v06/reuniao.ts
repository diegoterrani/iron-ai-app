/**
 * Modo reunião do Self (24/11/2026): a lista de todas as perguntas, com o que
 * já está respondido, o que espera confirmação e o que falta. Só funções
 * puras sobre o questionário e o rascunho: serve à tela (cliente) e aos testes.
 * Não grava nem calcula nada do resultado.
 */
import { textoFaixa, type Questionario06, type Rascunho06 } from "./questionario";

export type SituacaoPergunta = "respondida" | "a_confirmar" | "pendente";

export interface PerguntaReuniao {
  /** Campo do rascunho ("nucleo.<id>" no aprofundamento). */
  campo: string;
  bloco: string;
  pergunta: string;
  /** Opções para o consultor ter à vista (texto curto). */
  opcoes: string;
  /** Resposta gravada, em texto simples; nulo quando ainda não há. */
  valor: string | null;
  situacao: SituacaoPergunta;
}

const reais = new Intl.NumberFormat("pt-BR");
const nome = (lista: { id: string; nome: string }[], id: string) => lista.find((i) => i.id === id)?.nome ?? id;

/**
 * Campos do rascunho que cada pergunta da lista cobre (faixa e exato contam
 * como a mesma pergunta). Usado para casar os itens "a confirmar".
 */
const CAMPOS: Record<string, string[]> = {
  linhas_vermelhas: ["linhas_vermelhas", "linhas_vermelhas_outro"],
  receita: ["receita_valor", "receita_faixa"],
  pessoas: ["pessoas"],
  divisao: ["divisao"],
  folha: ["folha", "folha_exata"],
  custo: ["custo", "custo_exato"],
  contratacoes: ["contratacoes"],
  margem: ["margem", "margem_exata"],
  dor: ["dor"],
  uso_ia: ["uso_ia"],
  politica: ["politica"],
  patrocinio: ["patrocinio"],
};

/**
 * Todas as perguntas do Self 0.6, na ordem do roteiro, com a situação de
 * cada uma. `aConfirmar` são os campos que a escuta ouviu com dúvida.
 */
export function perguntasDaReuniao(q: Questionario06, r: Rascunho06, aConfirmar: readonly string[] = []): PerguntaReuniao[] {
  const duvida = new Set(aConfirmar);
  const item = (campo: string, bloco: string, pergunta: string, opcoes: string[], valor: string | null): PerguntaReuniao => {
    const cobertos = CAMPOS[campo] ?? [campo];
    const situacao: SituacaoPergunta = cobertos.some((c) => duvida.has(c)) ? "a_confirmar" : valor !== null ? "respondida" : "pendente";
    return { campo, bloco, pergunta, opcoes: opcoes.join(" · "), valor, situacao };
  };
  const faixa = (f: string | undefined, exata: number | undefined) => (f === undefined && exata === undefined ? null : textoFaixa(f, exata));

  const linhas = r.linhas_vermelhas?.length
    ? [...r.linhas_vermelhas.map((id) => nome(q.linhasVermelhas, id)), ...(r.linhas_vermelhas_outro ? [r.linhas_vermelhas_outro] : [])].join(", ")
    : null;
  const receita = r.receita_valor !== undefined ? `R$ ${reais.format(r.receita_valor)}` : (r.receita_faixa ?? null);
  const divisao =
    r.divisao && Object.keys(r.divisao).length > 0
      ? Object.entries(r.divisao)
          .map(([id, pct]) => `${nome(q.segmentos, id)} ${pct}%`)
          .join(", ")
      : null;

  return [
    item("linhas_vermelhas", "O que é intocável", "O que a IA nunca pode tocar no negócio?", q.linhasVermelhas.map((l) => l.nome), linhas),
    item("receita", "Retrato econômico", "Faturamento anual (valor aproximado ou faixa)", q.opcoes.receita, receita),
    item("pessoas", "Retrato econômico", "Quantas pessoas trabalham na empresa?", q.opcoes.pessoas, r.pessoas ?? null),
    item("divisao", "Retrato econômico", "Como a receita se divide por negócio (% que soma 100)?", q.segmentos.map((s) => s.nome), divisao),
    item("folha", "Retrato econômico", "Peso da folha com encargos na receita", q.opcoes.folha, faixa(r.folha, r.folha_exata)),
    item("custo", "Retrato econômico", q.custoPrincipal.pergunta, q.opcoes.custo, faixa(r.custo, r.custo_exato)),
    item("contratacoes", "Retrato econômico", "Contratações por ano, comparadas ao quadro", q.opcoes.contratacoes, r.contratacoes ?? null),
    item("margem", "Retrato econômico", "Margem líquida hoje", q.opcoes.margem, faixa(r.margem, r.margem_exata)),
    item("dor", "Onde dói", "Se pudesse resolver um problema em 6 semanas, qual seria?", q.dores.map((d) => d.nome), r.dor ? nome(q.dores, r.dor) : null),
    ...q.perguntas.map((p) => item(`nucleo.${p.id}`, "Aprofundamento", p.texto, p.opcoes, r.nucleo?.[p.id] ?? null)),
    item("uso_ia", "Prontidão", "Como a empresa usa IA hoje?", q.opcoes.usoIa, r.uso_ia ?? null),
    item("politica", "Prontidão", "Existe regra escrita sobre IA e dados?", q.opcoes.politica, r.politica ?? null),
    item("patrocinio", "Prontidão", "Quem patrocina e há orçamento?", q.opcoes.patrocinio, r.patrocinio ?? null),
  ];
}

/** Quantas perguntas já têm resposta, e quantas esperam confirmação. */
export function contagemDaReuniao(lista: readonly PerguntaReuniao[]) {
  return {
    total: lista.length,
    respondidas: lista.filter((p) => p.situacao === "respondida").length,
    aConfirmar: lista.filter((p) => p.situacao === "a_confirmar").length,
  };
}
