/**
 * Definição do questionário do Self assessment que vai para a tela.
 * Só tipos e funções puras: pode ser importado por componentes de cliente
 * sem levar o motor nem os JSON do modelo para o navegador.
 */
import { ordenarAreasQ6 } from "./areas";

export interface Orientacao {
  por_que?: string;
  como_responder?: string;
  exemplo?: string;
  se_nao_souber?: string;
}

export interface Opcoes {
  receita: string[];
  pessoasTotal: string[];
  pessoasArea: string[];
  margem: string[];
  ticket: string[];
  fila: string[];
  nivelQ5: string[];
  q8: string[];
  q9: string[];
  q10: string[];
  q11: string[];
  q12: string[];
  cobertura: string[];
}

export interface Questionario {
  setor: string;
  versaoPacote: string;
  opcoes: Opcoes;
  /** Áreas avaliadas na pergunta 5, na ordem de peso no setor. */
  areasQ5: { id: string; nome: string }[];
  /** Dados para escolher as áreas da pergunta 6 (mesma função do motor). */
  q6: { candidatas: string[]; pesos: Record<string, number>; notaQ5: Record<string, number>; quantidade: number };
  setoriais: {
    S1: { texto: string; orientacao: Orientacao };
    S2: { texto: string; orientacao: Orientacao };
    S3: { texto: string; orientacao: Orientacao };
  };
  dados: { texto: string; itens: { id: string; nome: string }[] };
}

/** Respostas como ficam gravadas (mesma forma que o motor recebe). */
export interface RespostasSelf {
  setor?: string;
  q2_valor?: number | null;
  q2?: string;
  q3?: string;
  q4?: string;
  setoriais?: { unidades?: number; lugares_total?: number; ticket_pessoa?: string; fila_pico?: string };
  grade_q5?: Record<string, string>;
  pessoas_q6?: Record<string, string>;
  q7?: string;
  q8?: string;
  dados_D?: Record<string, string>;
  q9?: string;
  q10?: string;
  q11?: string;
  q12?: string;
}

/** Opções fixas das perguntas que não alimentam o cálculo. */
export const OPCOES_MARGEM = ["negativa", "até 5%", "5 a 10%", "10 a 20%", "acima de 20%", "prefiro não dizer"];
export const OPCOES_OBJETIVO = [
  "reduzir custo",
  "crescer sem contratar",
  "melhorar qualidade ou atendimento",
  "ainda explorando",
];
export const Q7_MAX = 500;

export const PASSOS = [
  { id: "perfil", titulo: "Perfil da empresa" },
  { id: "setor", titulo: "Operação" },
  { id: "esforco", titulo: "Onde está o esforço" },
  { id: "pessoas", titulo: "Pessoas por área" },
  { id: "dados", titulo: "Dados" },
  { id: "prontidao", titulo: "Prontidão e objetivo" },
] as const;
export type PassoId = (typeof PASSOS)[number]["id"];

/**
 * Áreas da pergunta 6 a partir da grade da pergunta 5. Enquanto a grade
 * estiver incompleta, devolve lista vazia (a pergunta 6 espera a 5).
 */
export function areasQ6(q: Questionario, grade: Record<string, string> | undefined): string[] {
  const notas: Record<string, number> = {};
  for (const a of q.q6.candidatas) {
    const v = grade?.[a];
    if (v === undefined || !Object.hasOwn(q.q6.notaQ5, v)) return [];
    notas[a] = q.q6.notaQ5[v];
  }
  return ordenarAreasQ6(q.q6.candidatas, q.q6.pesos, notas, q.q6.quantidade);
}

/** Mantém em pessoas_q6 só as áreas que a pergunta 6 pede agora. */
export function ajustarPessoasQ6(q: Questionario, r: RespostasSelf): RespostasSelf {
  const areas = areasQ6(q, r.grade_q5);
  const atual = r.pessoas_q6 ?? {};
  const novo: Record<string, string> = {};
  for (const a of areas) if (Object.hasOwn(atual, a)) novo[a] = atual[a];
  return { ...r, pessoas_q6: novo };
}

/** Passos ainda incompletos, para a revisão final. Espelha o schema de conclusão. */
export function pendencias(q: Questionario, r: RespostasSelf): { passo: PassoId; texto: string }[] {
  const p: { passo: PassoId; texto: string }[] = [];
  if ((r.q2_valor === undefined || r.q2_valor === null) && !r.q2) p.push({ passo: "perfil", texto: "Faturamento anual" });
  if (!r.q3) p.push({ passo: "perfil", texto: "Número de pessoas" });
  const s = r.setoriais ?? {};
  if (s.unidades === undefined || s.lugares_total === undefined) p.push({ passo: "setor", texto: "Unidades e lugares" });
  if (!s.ticket_pessoa) p.push({ passo: "setor", texto: "Ticket médio" });
  if (!s.fila_pico) p.push({ passo: "setor", texto: "Fila no pico" });
  const faltaQ5 = q.areasQ5.filter((a) => !r.grade_q5?.[a.id]);
  if (faltaQ5.length) p.push({ passo: "esforco", texto: `Como cada área trabalha (${faltaQ5.length} sem resposta)` });
  const q6 = areasQ6(q, r.grade_q5);
  if (q6.length === 0 || q6.some((a) => !r.pessoas_q6?.[a])) p.push({ passo: "pessoas", texto: "Pessoas por área" });
  if (!r.q8) p.push({ passo: "dados", texto: "Onde ficam os dados" });
  const faltaD = q.dados.itens.filter((i) => !r.dados_D?.[i.id]);
  if (faltaD.length) p.push({ passo: "dados", texto: `Informações registradas (${faltaD.length} sem resposta)` });
  if (!r.q9) p.push({ passo: "prontidao", texto: "Uso de IA hoje" });
  if (!r.q10) p.push({ passo: "prontidao", texto: "Política de IA e dados" });
  if (!r.q11) p.push({ passo: "prontidao", texto: "Patrocínio e orçamento" });
  if (!r.q12) p.push({ passo: "prontidao", texto: "Objetivo principal" });
  return p;
}
