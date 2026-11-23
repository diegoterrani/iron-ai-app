/**
 * Self 0.6 (roteiro curto da skill do Self, 20/11/2026): tipos do pacote, das
 * respostas e do resultado. O formato 0.5 continua nos arquivos de cima
 * (motor.ts, tipos.ts) para os assessments antigos.
 */

import type { PrecosReferencia } from "./fluxo";

export const FORMATO_06 = "0.6";

type Faixa = [number, number];
/** Conservador e base: só a taxa muda (uma camada de conservadorismo). */
export type Taxa = [number, number];

export interface OpcaoNucleo {
  texto: string;
  /** Multiplica a taxa da alavanca (0 = não se aplica ao negócio). */
  fator: number;
  /** A empresa já registra esse dado (entra na nota de Dados). */
  registro: boolean;
  /** Resposta "não sei" ou "não medimos": a linha vira hipótese. */
  hipotese?: boolean;
}

export interface PerguntaNucleo {
  alavanca: string;
  texto: string;
  opcoes: OpcaoNucleo[];
}

export type BaseAlavanca = "cmv_por_segmento" | "cmv_total" | "folha_operacao" | "folha_retaguarda" | "receita_segmentos";

export interface AlavancaPacote {
  nome: string;
  linha_dre: string;
  base: BaseAlavanca;
  taxa?: Taxa;
  taxa_por_segmento?: Record<string, Taxa>;
  segmentos?: string[];
  pergunta?: string;
  fator_contratacoes?: boolean;
  /** Ganho que só vira caixa se a empresa não repuser parte das vagas que abrem. */
  depende_de_vagas?: boolean;
  /** Taxa sem referência de mercado confiável: a linha é sempre hipótese. */
  taxa_sem_referencia?: boolean;
  dado_deep: string;
}

export interface Pacote06 {
  pacote: string;
  versao: string;
  segmentos: { id: string; nome: string }[];
  custo_principal: { nome: string; pergunta: string };
  faixas: {
    folha: Record<string, Faixa>;
    custo: Record<string, Faixa>;
    margem: Record<string, Faixa>;
    contratacoes: Record<string, number>;
  };
  referencias: {
    folha_pct: number;
    margem: number;
    retaguarda_pct_folha: number;
    custo_pct_por_segmento: Record<string, number>;
  };
  linhas_vermelhas: { id: string; nome: string; bloqueia: string[] }[];
  dores: { id: string; nome: string; alavanca: string; piloto: { titulo: string; meta: string; kpi: string } }[];
  alavancas: Record<string, AlavancaPacote>;
  perguntas: Record<string, PerguntaNucleo>;
  aprofundar_max: number;
  prontidao: {
    uso_ia: Record<string, number>;
    politica: Record<string, number>;
    patrocinio: Record<string, number>;
    pesos: { estrategia: number; dados: number; governanca: number; pessoas: number };
    dados_sem_resposta: number;
  };
  regua: {
    precos: PrecosReferencia;
    /** Cada alavanca entra em uma onda; a primeira onda recebe o desconto do Deep dive. */
    ondas: { id: string; nome: string; inicio: number; go_live: number; alavancas: string[] }[];
    retorno_minimo_x: number;
    retorno_deep_x: number;
  };
  riscos: string[];
}

/** "não sei" vale em toda pergunta do retrato econômico. */
export const NAO_SEI = "não sei";

/** Respostas do Self 0.6, como são gravadas e como o motor recebe. */
export interface Respostas06 {
  formato: typeof FORMATO_06;
  setor: string;
  linhas_vermelhas?: string[];
  linhas_vermelhas_outro?: string;
  receita_valor?: number;
  receita_faixa?: string;
  pessoas?: string;
  /** % da receita por segmento; soma 100. */
  divisao?: Record<string, number>;
  /** Faixa ou "não sei"; folha_exata (%) tem precedência. */
  folha?: string;
  folha_exata?: number;
  custo?: string;
  custo_exato?: number;
  contratacoes?: string;
  margem?: string;
  margem_exata?: number;
  dor?: string;
  /** Perguntas de aprofundamento (id da pergunta → texto da opção). */
  nucleo?: Record<string, string>;
  uso_ia?: string;
  politica?: string;
  patrocinio?: string;
}

/** Selo de certeza da base de cada conta. */
export type Certeza = "medido" | "estimado" | "hipotese";

export interface Linha06 {
  alavanca: string;
  nome: string;
  linha_dre: string;
  conservador: number;
  base: number;
  certeza: Certeza;
  /** Por que a linha tem esse selo, em uma frase. */
  motivo_certeza: string;
  dado_deep: string;
  depende_de_vagas: boolean;
  /** Linha zerada: por quê (linha vermelha, segmento ausente, resposta do cliente). */
  fora?: string;
}

export type Veredito = "seguir" | "deep_para_confirmar" | "comecar_pequeno";

export interface Resultado06 {
  versoes: { motor: string; modelo: string; pacote: string };
  hash_respostas: string;
  formato: typeof FORMATO_06;
  empresa: {
    receita: number;
    receita_certeza: Certeza;
    margem: number;
    margem_certeza: Certeza;
    lucro: number;
    folha: number;
    folha_certeza: Certeza;
    custo: number;
    custo_certeza: Certeza;
    pessoas: string;
    contratacoes: string;
  };
  /** Ganho anual em regime (depois da implantação), conservador e base. */
  total: { conservador: number; base: number };
  /** Ganho do primeiro ano com a prontidão de hoje. */
  ano1: { conservador: number; base: number };
  pct_lucro: { conservador: number | null; base: number | null };
  por_mes: number;
  linhas: Linha06[];
  linhas_vermelhas: { id: string; nome: string }[];
  linhas_vermelhas_outro: string | null;
  bloqueadas: { alavanca: string; nome: string; por: string }[];
  pessoas: { horas_liberadas: number; pct_do_ganho: number; contratacoes: string; bloqueado_por_quadro: boolean };
  ganho_rapido: { dor: string; titulo: string; meta: string; kpi: string; valor_alavanca: number };
  prontidao: {
    score: number;
    nivel: string;
    teto: number | null;
    R: number;
    notas: { estrategia: number; dados: number; governanca: number; pessoas: number };
  };
  alertas: { codigo: string; texto: string }[];
  deep: { itens: { nome: string; valor: number; certeza: Certeza; dado: string }[]; valor_em_jogo: number };
  regua: {
    /** Investimento de referência em 24 meses (IRON + tecnologia). */
    investimento_24m: number;
    /** Motor 0.6.0 (régua antiga): custo de mudança. Resultados do motor 0.7.0 em diante não têm. */
    custo_mudanca_24m?: number;
    /** Motor 0.7.0 em diante: fluxo de caixa com a tabela de preço do pacote. */
    fluxo?: {
      investimento_iron_24m: number;
      tecnologia_24m: number;
      cruzamento_mes: number | null;
      exposicao_max: number;
      sobra_socios_24m: number;
      ir_csll: number;
      ondas: { id: string; nome: string; go_live: number; ganho_anual: number }[];
      meses: { mes: number; investido_acum: number; ganho_acum: number }[];
    };
    ganho_24m: number;
    retorno_x: number;
    veredito: Veredito;
  };
  riscos: string[];
}
