/**
 * Fluxo de caixa de referência do Self 0.6 (motor 0.7.0): quanto a empresa
 * investe e quanto ganha mês a mês nos 24 meses, com a tabela de preço do
 * pacote. Mesma conta do deck da reunião (Deep dive, duas ondas, operação e
 * tecnologia por onda, rampa de 3 meses).
 *
 * Função pura, sem I/O e sem LLM: mesmas entradas, mesmo resultado. Os
 * acumulados são arredondados mês a mês para reais inteiros, como no deck,
 * para os dois nunca mostrarem números diferentes.
 */
import { RespostaInvalida } from "../erros";

/** Tabela de preço de referência (versionada no pacote do setor). */
export interface PrecosReferencia {
  meses: number;
  deep: { preco: number; meses: number[] };
  onda: {
    preco: number;
    /** Fração paga no início da onda; o resto em parcelas iguais a partir do go-live. */
    entrada: number;
    parcelas: number;
    /** Fração do Deep dive descontada da primeira onda. */
    desconto_deep_onda1: number;
    operacao_mes: number;
    tecnologia_mes: number;
    rampa_meses: number;
  };
  ir_csll: number;
}

export interface OndaFluxo {
  id: string;
  /** Mês em que a onda começa (paga a entrada). */
  inicio: number;
  /** Mês do go-live: começam as parcelas, a operação, a tecnologia e o ganho. */
  go_live: number;
  /** Ganho anual em ritmo de cruzeiro que a onda captura. */
  ganho_anual: number;
}

export interface MesFluxo {
  mes: number;
  investido_acum: number;
  ganho_acum: number;
}

export interface ResultadoFluxo {
  meses: MesFluxo[];
  /** Investimento total em 24 meses (IRON + tecnologia). */
  investido: number;
  /** Deep dive, ondas e operação. */
  investido_iron: number;
  tecnologia: number;
  ganho: number;
  retorno_x: number;
  /** Primeiro mês em que o ganho acumulado passa o investido; null se não passa nos 24 meses. */
  cruzamento_mes: number | null;
  /** Maior diferença entre investido e ganho acumulados (o máximo que fica "no vermelho"). */
  exposicao_max: number;
  /** (ganho − investido) depois de IR/CSLL. */
  sobra_socios: number;
}

const finitoNaoNegativo = (v: number) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function validar(p: PrecosReferencia, ondas: OndaFluxo[], prontidao: number) {
  if (!Number.isInteger(p.meses) || p.meses < 1 || p.meses > 120) throw new RespostaInvalida("fluxo: horizonte de meses inválido");
  if (!(prontidao >= 0 && prontidao <= 1)) throw new RespostaInvalida("fluxo: prontidão deve ficar entre 0 e 1");
  const precos = [p.deep.preco, p.onda.preco, p.onda.operacao_mes, p.onda.tecnologia_mes, p.ir_csll, p.onda.entrada, p.onda.desconto_deep_onda1];
  if (!precos.every(finitoNaoNegativo)) throw new RespostaInvalida("fluxo: tabela de preço com valor inválido");
  if (p.onda.entrada > 1 || !Number.isInteger(p.onda.parcelas) || p.onda.parcelas < 1 || !(p.onda.rampa_meses >= 1)) {
    throw new RespostaInvalida("fluxo: condições de pagamento inválidas");
  }
  for (const o of ondas) {
    if (!finitoNaoNegativo(o.ganho_anual) || !Number.isInteger(o.inicio) || !Number.isInteger(o.go_live) || o.inicio < 1 || o.go_live < o.inicio) {
      throw new RespostaInvalida(`fluxo: onda '${o.id}' com datas ou ganho inválidos`);
    }
  }
}

/**
 * Calcula o fluxo de 24 meses. Ondas sem ganho não entram (ninguém contrata
 * uma onda que não captura nada). `prontidao` (0 a 1) escala o ganho; o
 * relatório usa 1, como o deck.
 */
export function fluxoCaixa(p: PrecosReferencia, ondas: OndaFluxo[], prontidao = 1): ResultadoFluxo {
  validar(p, ondas, prontidao);
  const M = p.meses;
  const iron = new Array<number>(M + 1).fill(0);
  const tec = new Array<number>(M + 1).fill(0);
  const ganho = new Array<number>(M + 1).fill(0);
  const add = (arr: number[], m: number, v: number) => {
    if (m >= 1 && m <= M) arr[m] += v;
  };

  const mesesDeep = p.deep.meses.length > 0 ? p.deep.meses : [1];
  for (const m of mesesDeep) add(iron, m, p.deep.preco / mesesDeep.length);

  const ativas = ondas.filter((o) => o.ganho_anual > 0);
  ativas.forEach((o, i) => {
    const preco = Math.max(0, p.onda.preco - (i === 0 ? p.deep.preco * p.onda.desconto_deep_onda1 : 0));
    add(iron, o.inicio, p.onda.entrada * preco);
    for (let k = 0; k < p.onda.parcelas; k++) add(iron, o.go_live + k, ((1 - p.onda.entrada) * preco) / p.onda.parcelas);
    for (let m = o.go_live; m <= M; m++) {
      add(iron, m, p.onda.operacao_mes);
      add(tec, m, p.onda.tecnologia_mes);
      add(ganho, m, (o.ganho_anual / 12) * Math.min(1, (m - o.go_live + 1) / p.onda.rampa_meses) * prontidao);
    }
  });

  const meses: MesFluxo[] = [];
  let a = 0;
  let b = 0;
  let cruzamento: number | null = null;
  let exposicao = 0;
  for (let m = 1; m <= M; m++) {
    a += iron[m] + tec[m];
    b += ganho[m];
    const inv = Math.round(a);
    const gan = Math.round(b);
    meses.push({ mes: m, investido_acum: inv, ganho_acum: gan });
    if (cruzamento === null && inv > 0 && gan > inv) cruzamento = m;
    exposicao = Math.max(exposicao, inv - gan);
  }
  const ultimo = meses[meses.length - 1];
  const tecnologia = Math.round(tec.reduce((s, v) => s + v, 0));
  return {
    meses,
    investido: ultimo.investido_acum,
    investido_iron: ultimo.investido_acum - tecnologia,
    tecnologia,
    ganho: ultimo.ganho_acum,
    retorno_x: ultimo.investido_acum > 0 ? ultimo.ganho_acum / ultimo.investido_acum : 0,
    cruzamento_mes: cruzamento,
    exposicao_max: exposicao,
    sobra_socios: Math.round((ultimo.ganho_acum - ultimo.investido_acum) * (1 - p.ir_csll)),
  };
}
