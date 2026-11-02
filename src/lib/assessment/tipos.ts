/** Tipos do motor do Self assessment. Espelham modelo_comum.json e os pacotes setoriais. */

type Faixa = [number, number];

export interface Modelo {
  versao: string;
  pesos_dimensoes: Record<string, number>;
  travas: { dimensoes: string[]; nota_max: number; teto: number }[];
  fator_R: { minimo: number; amplitude: number };
  niveis: [number, string][];
  nota_max_self: number;
  areas: Record<string, string>;
  areas_operacionais: string[];
  e_a_benchmark: Record<string, Record<string, number>>;
  self: {
    faixas_receita: Record<string, Faixa>;
    faixas_pessoas_total: Record<string, Faixa>;
    faixas_pessoas_area: Record<string, Faixa>;
    faixas_ticket: Record<string, Faixa>;
    nota_q5: Record<string, number>;
    nota_q8: Record<string, number>;
    nota_q9: Record<string, number>;
    nota_q10: Record<string, number>;
    nota_q11: Record<string, number>;
    cobertura_fonte: Record<string, number>;
    areas_no_calculo: number;
    receita_por_pessoa_plausivel: Faixa;
  };
}

export interface Alavanca {
  nome: string;
  linha_dre: string;
  formula: string;
  condicao?: { campo: string; em: string[] };
  [parametro: string]: unknown;
}

export interface Pacote {
  pacote: string;
  versao: string;
  parametros_padrao: Record<string, { valor: number; [k: string]: unknown }> & {
    C_custo_anual_por_pessoa: { valor: number };
  };
  areas: {
    distribuicao_tipica_pessoas: Record<string, number | string>;
    e_a_ajustado?: Record<string, Record<string, number>>;
    [k: string]: unknown;
  };
  perguntas_self: Record<string, unknown>;
  pergunta_dados_D: { texto: string; itens: string[]; [k: string]: unknown };
  catalogo_fontes: Record<string, { nome: string; se_faltar: string; criar_fonte?: boolean; [k: string]: unknown }>;
  alavancas: Record<string, Alavanca>;
  self_alavancas_max: number;
  self_ordem_alavancas: string[];
  casos_de_uso?: { id: string; nome: string; area: string; alavanca: string }[];
}

/** Respostas como o questionário envia. A validação de forma (zod) acontece antes do motor. */
export interface Respostas {
  setor: string;
  q2_valor?: number | null;
  q2?: string;
  q3: string;
  q4?: string;
  setoriais?: Record<string, unknown>;
  grade_q5?: Record<string, string>;
  pessoas_q6?: Record<string, string>;
  q7?: string;
  q8: string;
  dados_D?: Record<string, string>;
  q9: string;
  q10: string;
  q11: string;
  q12?: string;
}

interface Cenario {
  receita_usada: number;
  pessoas: { area: string; fte: number; e_a: number; valor: number }[];
  alavancas: { alavanca: string; nome: string; linha_dre: string; valor: number; motivo?: string }[];
  potencial_bruto: number;
  R: number;
  P: number;
  delta_margem_pp: number | null;
}

export interface ResultadoSelf {
  versoes: { motor: string; modelo: string; pacote: string };
  hash_respostas: string;
  avisos: string[];
  precisao_receita: string;
  score: {
    valor: number;
    teto_aplicado: number | null;
    nivel: string;
    nota_prontidao: number;
    dimensoes: Record<string, number>;
    cobertura_fontes: number;
    ressalva: string;
  };
  score_por_area: Record<string, number>;
  areas_sugeridas_q6: string[];
  retorno: { conservador: Cenario; base: Cenario };
  top3: { origem: string; valor_conservador: number; exemplo: string | null }[];
  o_que_destrava: { dimensao: string; score_novo: number; ganho_score_pp: number; ganho_retorno: number }[];
  mapa_de_dados: { fonte: string; nome: string; situacao: string; como_criar?: string; criar_fonte_com_ia?: boolean }[];
}
