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
  /** 0.4.0: tipos de unidade que o Self aceita e o que cada um pergunta. */
  segmentos: SegmentoSelf[];
  unidades: {
    U1: { texto: string; orientacao: Orientacao };
    I1: { texto: string; orientacao: Orientacao };
  };
  maxUnidades: number;
}

export type CampoUnidade = "lugares_total" | "ticket_pessoa" | "fila_pico" | "refeicoes_dia";

export interface SegmentoSelf {
  id: string;
  nome: string;
  abrange: string;
  campos: CampoUnidade[];
}

/** Um tipo de unidade no rascunho: tudo opcional até concluir. */
export interface UnidadeSelf {
  segmento: string;
  quantidade?: number;
  participacao_receita?: number;
  lugares_total?: number;
  ticket_pessoa?: string;
  fila_pico?: string;
  refeicoes_dia?: number;
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
  /** 0.4.0: tipos de unidade de negócio; substitui `setoriais` nos rascunhos novos. */
  unidades?: UnidadeSelf[];
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

/**
 * Rascunho de antes de 0.4.0 (perguntas S1 a S3) vira um tipo de unidade
 * "restaurantes" com 100% da receita. O motor dá o mesmo resultado nos dois
 * formatos (teste em assessment-motor).
 */
export function paraUnidades(r: RespostasSelf): RespostasSelf {
  if (r.unidades !== undefined || r.setoriais === undefined) return r;
  const { setoriais: s, ...resto } = r;
  const u: UnidadeSelf = { segmento: "restaurantes", participacao_receita: 100 };
  if (s.unidades !== undefined) u.quantidade = s.unidades;
  if (s.lugares_total !== undefined) u.lugares_total = s.lugares_total;
  if (s.ticket_pessoa !== undefined) u.ticket_pessoa = s.ticket_pessoa;
  if (s.fila_pico !== undefined) u.fila_pico = s.fila_pico;
  return { ...resto, unidades: [u] };
}

/** Soma da participação na receita, arredondada a uma casa para a tela. */
export function somaParticipacao(us: UnidadeSelf[] | undefined): number {
  const total = (us ?? []).reduce((acc, u) => acc + (u.participacao_receita ?? 0), 0);
  return Math.round(total * 10) / 10;
}

/** Mesma tolerância do motor: a soma precisa ficar a até 0,5 ponto de 100%. */
export const somaFecha = (us: UnidadeSelf[] | undefined) => Math.abs(somaParticipacao(us) - 100) <= 0.5;

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
  p.push(...pendenciasUnidades(q, r));
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

const ROTULO_CAMPO: Record<CampoUnidade, string> = {
  lugares_total: "lugares no salão",
  ticket_pessoa: "ticket médio",
  fila_pico: "fila no pico",
  refeicoes_dia: "refeições por dia",
};

/** Pendências do passo Operação (tipos de unidade). Rascunho antigo é lido como uma unidade de restaurante. */
export function pendenciasUnidades(q: Questionario, r: RespostasSelf): { passo: PassoId; texto: string }[] {
  const us = paraUnidades(r).unidades ?? [];
  if (us.length === 0) return [{ passo: "setor", texto: "Tipos de operação da empresa" }];
  const p: { passo: PassoId; texto: string }[] = [];
  for (const u of us) {
    const seg = q.segmentos.find((s) => s.id === u.segmento);
    if (!seg) {
      p.push({ passo: "setor", texto: "Tipo de operação inválido" });
      continue;
    }
    const faltam: string[] = [];
    if (u.quantidade === undefined) faltam.push("quantidade");
    if (u.participacao_receita === undefined) faltam.push("parte do faturamento");
    for (const c of seg.campos) if (u[c] === undefined) faltam.push(ROTULO_CAMPO[c]);
    if (faltam.length) p.push({ passo: "setor", texto: `${seg.nome}: ${faltam.join(", ")}` });
  }
  if (!somaFecha(us)) p.push({ passo: "setor", texto: "A parte do faturamento de cada tipo precisa somar 100%" });
  return p;
}
