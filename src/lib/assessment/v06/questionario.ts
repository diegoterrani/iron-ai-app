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
