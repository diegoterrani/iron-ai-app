/**
 * Definição do questionário do Self assessment que vai para a tela.
 * Só tipos e funções puras: pode ser importado por componentes de cliente
 * sem levar o motor nem os JSON do modelo para o navegador.
 */
import { cnpjValido } from "@/lib/validation/cnpj";
import { mediaMarcadas, ordenarAreasQ6 } from "./areas";

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

/**
 * Respostas na forma atual (motor 0.3.0): perguntas de escolha múltipla são
 * listas, na ordem das opções. É a forma gravada e a que o motor recebe.
 */
export interface RespostasSelf {
  setor?: string;
  q2_valor?: number | null;
  q2?: string;
  q3?: string;
  q4?: string;
  setoriais?: { unidades?: number; lugares_total?: number; ticket_pessoa?: string; fila_pico?: string };
  grade_q5?: Record<string, string[]>;
  pessoas_q6?: Record<string, string>;
  q7?: string;
  q8?: string[];
  dados_D?: Record<string, string>;
  q9?: string[];
  q10?: string;
  q11?: string;
  q12?: string[];
}

/** Rascunhos gravados antes da escolha múltipla têm texto onde hoje há lista. */
type Multipla = string | string[] | undefined;
export type RespostasGravadas = Omit<RespostasSelf, "grade_q5" | "q8" | "q9" | "q12"> & {
  grade_q5?: Record<string, Multipla>;
  q8?: Multipla;
  q9?: Multipla;
  q12?: Multipla;
};

const comoLista = (v: Multipla): string[] | undefined => (v === undefined ? undefined : typeof v === "string" ? [v] : v);

/** Converte um rascunho antigo (uma opção por pergunta) para a forma atual. */
export function paraEscolhaMultipla(r: RespostasGravadas): RespostasSelf {
  const { grade_q5, q8, q9, q12, ...resto } = r;
  const novo: RespostasSelf = { ...resto };
  if (grade_q5) {
    const grade: Record<string, string[]> = {};
    for (const [a, v] of Object.entries(grade_q5)) {
      const l = comoLista(v);
      if (l) grade[a] = l;
    }
    novo.grade_q5 = grade;
  }
  if (q8 !== undefined) novo.q8 = comoLista(q8);
  if (q9 !== undefined) novo.q9 = comoLista(q9);
  if (q12 !== undefined) novo.q12 = comoLista(q12);
  return novo;
}

/** Marca ou desmarca uma opção, mantendo a ordem da lista de opções. */
export function alternarOpcao(opcoes: readonly string[], atual: string[] | undefined, opcao: string, marcar: boolean): string[] {
  const marcadas = new Set(atual ?? []);
  if (marcar) marcadas.add(opcao);
  else marcadas.delete(opcao);
  return opcoes.filter((o) => marcadas.has(o));
}

const marcou = (v: string[] | undefined) => Boolean(v && v.length > 0);

/** Opções fixas das perguntas que não alimentam o cálculo. */
export const OPCOES_MARGEM = ["negativa", "até 5%", "5 a 10%", "10 a 20%", "acima de 20%", "prefiro não dizer"];
export const OPCOES_OBJETIVO = [
  "reduzir custo",
  "crescer sem contratar",
  "melhorar qualidade ou atendimento",
  "ainda explorando",
];
export const Q7_MAX = 500;

/** Cadastro da empresa avaliada e do contato principal (fora do cálculo). */
export interface EmpresaSelf {
  nome?: string;
  cnpj?: string;
  cidade?: string;
  uf?: string;
  contato_nome?: string;
  contato_cargo?: string;
  contato_email?: string;
  contato_telefone?: string;
}

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSOS = [
  { id: "empresa", titulo: "Empresa" },
  { id: "perfil", titulo: "Porte" },
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
export function areasQ6(q: Questionario, grade: Record<string, string[]> | undefined): string[] {
  const notas: Record<string, number> = {};
  for (const a of q.q6.candidatas) {
    // Mesma conta do motor: média das opções marcadas na área.
    const nota = mediaMarcadas(q.q6.notaQ5, grade?.[a]);
    if (nota === null) return [];
    notas[a] = nota;
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

/** Passos ainda incompletos, para a revisão final. O servidor usa a mesma regra ao concluir. */
export function pendencias(q: Questionario, r: RespostasSelf, e: EmpresaSelf = {}): { passo: PassoId; texto: string }[] {
  const p: { passo: PassoId; texto: string }[] = [];
  if (!e.nome?.trim()) p.push({ passo: "empresa", texto: "Nome da empresa" });
  if (!e.cnpj || !cnpjValido(e.cnpj)) p.push({ passo: "empresa", texto: "CNPJ válido" });
  if (!e.cidade?.trim() || !e.uf) p.push({ passo: "empresa", texto: "Cidade e UF" });
  if (!e.contato_nome?.trim() || !e.contato_cargo?.trim()) p.push({ passo: "empresa", texto: "Nome e cargo do contato principal" });
  if (!e.contato_email || !EMAIL.test(e.contato_email)) p.push({ passo: "empresa", texto: "E-mail do contato principal" });
  if ((r.q2_valor === undefined || r.q2_valor === null) && !r.q2) p.push({ passo: "perfil", texto: "Faturamento anual" });
  if (!r.q3) p.push({ passo: "perfil", texto: "Número de pessoas" });
  const s = r.setoriais ?? {};
  if (s.unidades === undefined || s.lugares_total === undefined) p.push({ passo: "setor", texto: "Unidades e lugares" });
  if (!s.ticket_pessoa) p.push({ passo: "setor", texto: "Ticket médio" });
  if (!s.fila_pico) p.push({ passo: "setor", texto: "Fila no pico" });
  const faltaQ5 = q.areasQ5.filter((a) => !marcou(r.grade_q5?.[a.id]));
  if (faltaQ5.length) p.push({ passo: "esforco", texto: `Como cada área trabalha (${faltaQ5.length} sem resposta)` });
  const q6 = areasQ6(q, r.grade_q5);
  if (q6.length === 0 || q6.some((a) => !r.pessoas_q6?.[a])) p.push({ passo: "pessoas", texto: "Pessoas por área" });
  if (!marcou(r.q8)) p.push({ passo: "dados", texto: "Onde ficam os dados" });
  const faltaD = q.dados.itens.filter((i) => !r.dados_D?.[i.id]);
  if (faltaD.length) p.push({ passo: "dados", texto: `Informações registradas (${faltaD.length} sem resposta)` });
  if (!marcou(r.q9)) p.push({ passo: "prontidao", texto: "Uso de IA hoje" });
  if (!r.q10) p.push({ passo: "prontidao", texto: "Política de IA e dados" });
  if (!r.q11) p.push({ passo: "prontidao", texto: "Patrocínio e orçamento" });
  if (!marcou(r.q12)) p.push({ passo: "prontidao", texto: "Objetivos principais" });
  return p;
}
