/**
 * Self 0.6: o que a tela e o agente precisam saber das perguntas (textos e
 * opções), sem taxas nem fórmulas. Só tipos e funções puras: pode ir para
 * componentes de cliente. O servidor monta o objeto a partir do pacote.
 */
import { cnpjValido } from "@/lib/validation/cnpj";
import { NAO_SEI, type Respostas06 } from "./tipos";

export interface Questionario06 {
  setor: string;
  versaoPacote: string;
  segmentos: { id: string; nome: string }[];
  custoPrincipal: { nome: string; pergunta: string };
  linhasVermelhas: { id: string; nome: string }[];
  dores: { id: string; nome: string }[];
  /** Máximo de perguntas de aprofundamento que o motor escolhe. */
  aprofundarMax: number;
  /** Perguntas de aprofundamento, na ordem do pacote. */
  perguntas: { id: string; alavanca: string; texto: string; opcoes: string[] }[];
  opcoes: {
    receita: string[];
    pessoas: string[];
    folha: string[];
    custo: string[];
    margem: string[];
    contratacoes: string[];
    usoIa: string[];
    politica: string[];
    patrocinio: string[];
  };
}

/** Cadastro da empresa avaliada (o mesmo do formato 0.5). */
export interface Empresa06 {
  nome?: string;
  cnpj?: string;
  cidade?: string;
  uf?: string;
  contato_nome?: string;
  contato_cargo?: string;
  contato_email?: string;
  contato_telefone?: string;
}

export type Rascunho06 = Partial<Respostas06>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Soma da divisão da receita, com uma casa. */
export function somaDivisao(d: Record<string, number> | undefined): number {
  const total = Object.values(d ?? {}).reduce((a, v) => a + v, 0);
  return Math.round(total * 10) / 10;
}

export const divisaoFecha = (d: Record<string, number> | undefined) => Math.abs(somaDivisao(d) - 100) <= 0.5;

const respondeu = (faixa: string | undefined, exata: number | undefined) => faixa !== undefined || exata !== undefined;

/**
 * O que falta para concluir. As perguntas de aprofundamento não bloqueiam:
 * sem resposta, a linha entra como hipótese (e o relatório diz isso).
 */
export function pendencias06(r: Rascunho06, e: Empresa06 = {}): string[] {
  const p: string[] = [];
  if (!e.nome?.trim()) p.push("Nome da empresa");
  if (!e.cnpj || !cnpjValido(e.cnpj)) p.push("CNPJ válido");
  if (!e.cidade?.trim() || !e.uf) p.push("Cidade e UF");
  if (!e.contato_nome?.trim() || !e.contato_cargo?.trim()) p.push("Nome e cargo do contato principal");
  if (!e.contato_email || !EMAIL.test(e.contato_email)) p.push("E-mail do contato principal");
  if (!r.linhas_vermelhas?.length) p.push("O que a IA nunca pode tocar");
  if (r.receita_valor === undefined && r.receita_faixa === undefined) p.push("Faturamento anual");
  if (!r.pessoas) p.push("Número de pessoas");
  if (!r.divisao || Object.keys(r.divisao).length === 0) p.push("Divisão da receita por negócio");
  else if (!divisaoFecha(r.divisao)) p.push("A divisão da receita precisa somar 100%");
  if (!respondeu(r.folha, r.folha_exata)) p.push("Peso da folha na receita");
  if (!respondeu(r.custo, r.custo_exato)) p.push("Peso dos insumos na receita");
  if (!r.contratacoes) p.push("Contratações por ano");
  if (!respondeu(r.margem, r.margem_exata)) p.push("Margem");
  if (!r.dor) p.push("Problema para resolver em 6 semanas");
  if (!r.uso_ia) p.push("Uso de IA hoje");
  if (!r.politica) p.push("Regra escrita sobre IA e dados");
  if (!r.patrocinio) p.push("Patrocínio e orçamento");
  return p;
}

/** Texto curto de uma resposta com faixa ou valor exato, para o resumo. */
export function textoFaixa(faixa: string | undefined, exata: number | undefined): string {
  if (exata !== undefined) return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(exata)}%`;
  if (faixa === NAO_SEI) return "não sei";
  return faixa ?? "—";
}

/** Um passo do roteiro, para o indicador de progresso. */
export interface Passo06 {
  id: string;
  nome: string;
  feito: boolean;
}

export interface Progresso06 {
  passos: Passo06[];
  feitos: number;
  total: number;
  /** Primeiro passo ainda aberto, na ordem do roteiro (undefined quando tudo foi respondido). */
  proximo?: Passo06;
}

/**
 * Passos do roteiro 0.6, na ordem da skill do Self, para o indicador "passo X
 * de N". Cada pergunta conta um passo; o cadastro da empresa conta um só.
 * As perguntas de aprofundamento entram pela lista que o motor escolheu
 * (`aprofundamento`, ids das perguntas). Enquanto o retrato econômico não
 * está completo a lista ainda não existe (null): reservamos o máximo do
 * pacote, para o total só diminuir depois, nunca crescer de surpresa.
 * Só lê o rascunho: não valida nem calcula nada do resultado.
 */
export function progresso06(q: Questionario06, r: Rascunho06, e: Empresa06 = {}, aprofundamento: string[] | null = null): Progresso06 {
  const empresaOk =
    !!e.nome?.trim() &&
    !!e.cnpj &&
    cnpjValido(e.cnpj) &&
    !!e.cidade?.trim() &&
    !!e.uf &&
    !!e.contato_nome?.trim() &&
    !!e.contato_cargo?.trim() &&
    !!e.contato_email &&
    EMAIL.test(e.contato_email);

  const passos: Passo06[] = [
    { id: "empresa", nome: "Cadastro da empresa", feito: empresaOk },
    { id: "linhas_vermelhas", nome: "O que a IA nunca pode tocar", feito: !!r.linhas_vermelhas?.length },
    { id: "receita", nome: "Faturamento anual", feito: r.receita_valor !== undefined || r.receita_faixa !== undefined },
    { id: "pessoas", nome: "Número de pessoas", feito: !!r.pessoas },
    { id: "divisao", nome: "Divisão da receita", feito: !!r.divisao && Object.keys(r.divisao).length > 0 && divisaoFecha(r.divisao) },
    { id: "folha", nome: "Peso da folha", feito: respondeu(r.folha, r.folha_exata) },
    { id: "custo", nome: "Peso dos insumos", feito: respondeu(r.custo, r.custo_exato) },
    { id: "contratacoes", nome: "Contratações por ano", feito: !!r.contratacoes },
    { id: "margem", nome: "Margem", feito: respondeu(r.margem, r.margem_exata) },
    { id: "dor", nome: "Problema para 6 semanas", feito: !!r.dor },
  ];
  if (aprofundamento === null) {
    for (let i = 1; i <= q.aprofundarMax; i++) passos.push({ id: `nucleo:previsto-${i}`, nome: "Pergunta de precisão", feito: false });
  } else {
    // Só ids que o questionário conhece, sem repetição: a lista vem do servidor.
    const conhecidas = new Set(q.perguntas.map((p) => p.id));
    for (const id of [...new Set(aprofundamento)].filter((x) => conhecidas.has(x)).slice(0, q.aprofundarMax)) {
      passos.push({ id: `nucleo:${id}`, nome: "Pergunta de precisão", feito: r.nucleo?.[id] !== undefined });
    }
  }
  passos.push(
    { id: "uso_ia", nome: "Uso de IA hoje", feito: !!r.uso_ia },
    { id: "politica", nome: "Regra sobre IA e dados", feito: !!r.politica },
    { id: "patrocinio", nome: "Patrocínio e orçamento", feito: !!r.patrocinio },
  );
  const feitos = passos.filter((p) => p.feito).length;
  return { passos, feitos, total: passos.length, proximo: passos.find((p) => !p.feito) };
}
