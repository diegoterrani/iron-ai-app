/**
 * Motor do Self 0.6 (roteiro curto da skill do Self, 20/11/2026).
 *
 * Único lugar onde os números do Self 0.6 nascem: mesmas respostas, mesmo
 * resultado, sempre. Nenhuma LLM participa. O agente só registra respostas.
 *
 *   linha = base da conta × taxa (conservador ou base) × fator da resposta
 *   regime = Σ linhas (potencial depois da implantação)
 *   ano 1 = regime × R, com R = 0,30 + 0,60 × score de prontidão
 *
 * A base de cada conta vem do retrato econômico que o cliente informou
 * (faturamento, folha, insumos, divisão da receita). Quando ele responde
 * "não sei", entra a referência do setor e a linha recebe o selo hipótese.
 * Qualquer mudança aqui exige subir MOTOR_VERSAO_06 e revisar os testes.
 */
import { hashRespostas, nivel, fatorR } from "../motor";
import { RespostaInvalida } from "../erros";
import type { Modelo, Respostas } from "../tipos";
import { divisaoFecha } from "./questionario";
import {
  FORMATO_06,
  NAO_SEI,
  type AlavancaPacote,
  type Certeza,
  type Linha06,
  type Pacote06,
  type Respostas06,
  type Resultado06,
  type Veredito,
} from "./tipos";

export const MOTOR_VERSAO_06 = "0.6.0";

const ORDEM_CERTEZA: Record<Certeza, number> = { medido: 0, estimado: 1, hipotese: 2 };
const pior = (a: Certeza, b: Certeza): Certeza => (ORDEM_CERTEZA[b] > ORDEM_CERTEZA[a] ? b : a);

interface Valor {
  valor: number;
  certeza: Certeza;
}

/** Busca a opção na tabela; chave fora da lista (ou herdada do protótipo) é recusada. */
function opcao<T>(tabela: Readonly<Record<string, T>>, chave: unknown, pergunta: string): T {
  if (typeof chave !== "string" || !Object.hasOwn(tabela, chave)) {
    throw new RespostaInvalida(`${pergunta}: '${String(chave)}' não é uma opção válida`);
  }
  return tabela[chave];
}

const meio = ([lo, hi]: readonly [number, number]) => (lo + hi) / 2;

/**
 * Percentual respondido por faixa, valor exato ou "não sei":
 * exato = medido; faixa = ponto médio, estimado; não sei = referência do setor, hipótese.
 */
function percentual(
  faixa: string | undefined,
  exata: number | undefined,
  tabela: Record<string, [number, number]>,
  referencia: number,
  pergunta: string,
): Valor {
  if (exata !== undefined) {
    if (typeof exata !== "number" || !Number.isFinite(exata) || exata < -50 || exata > 95) {
      throw new RespostaInvalida(`${pergunta}: percentual fora do razoável`);
    }
    return { valor: exata / 100, certeza: "medido" };
  }
  if (faixa === undefined) throw new RespostaInvalida(`${pergunta} sem resposta`);
  if (faixa === NAO_SEI) return { valor: referencia, certeza: "hipotese" };
  return { valor: meio(opcao(tabela, faixa, pergunta)), certeza: "estimado" };
}

function receita(r: Respostas06, modelo: Modelo): Valor {
  if (r.receita_valor !== undefined) {
    if (typeof r.receita_valor !== "number" || !Number.isFinite(r.receita_valor) || r.receita_valor <= 0) {
      throw new RespostaInvalida("faturamento: informe um valor positivo em R$");
    }
    return { valor: r.receita_valor, certeza: "medido" };
  }
  if (r.receita_faixa === undefined) throw new RespostaInvalida("faturamento sem resposta");
  return { valor: meio(opcao(modelo.self.faixas_receita, r.receita_faixa, "faturamento")), certeza: "estimado" };
}

/** Retrato econômico: as bases das contas, cada uma com o seu selo. */
interface Retrato {
  receita: Valor;
  folha: Valor;
  custo: Valor;
  margem: Valor;
  /** Participação de cada segmento na receita (0 a 1). */
  partes: Record<string, number>;
  /** CMV de cada segmento em R$. */
  cmv: Record<string, number>;
  contratacoes: { fator: number; certeza: Certeza };
}

function retrato(r: Respostas06, pacote: Pacote06, modelo: Modelo): Retrato {
  const rec = receita(r, modelo);
  const ref = pacote.referencias;
  const folhaPct = percentual(r.folha, r.folha_exata, pacote.faixas.folha, ref.folha_pct, "folha");
  const custoPct = percentual(r.custo, r.custo_exato, pacote.faixas.custo, NaN, "insumos");
  const margem = percentual(r.margem, r.margem_exata, pacote.faixas.margem, ref.margem, "margem");

  const divisao = r.divisao ?? {};
  const ids = pacote.segmentos.map((s) => s.id);
  for (const k of Object.keys(divisao)) if (!ids.includes(k)) throw new RespostaInvalida(`divisão da receita: segmento '${k}' desconhecido`);
  if (!divisaoFecha(divisao)) throw new RespostaInvalida("a divisão da receita por negócio precisa somar 100%");
  const partes: Record<string, number> = {};
  for (const id of ids) {
    const v = Object.hasOwn(divisao, id) ? divisao[id] : 0;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) throw new RespostaInvalida(`divisão da receita (${id}): use de 0 a 100%`);
    partes[id] = v / 100;
  }

  // CMV por segmento: com o percentual informado, o total é distribuído pelo peso típico de
  // cada segmento; com "não sei", cada segmento usa a referência do setor.
  const refSeg = ref.custo_pct_por_segmento;
  const pesos = Object.fromEntries(ids.map((id) => [id, partes[id] * (refSeg[id] ?? 0)]));
  const somaPesos = Object.values(pesos).reduce((a, v) => a + v, 0);
  const cmv: Record<string, number> = {};
  let custo: Valor;
  if (custoPct.certeza === "hipotese") {
    for (const id of ids) cmv[id] = rec.valor * pesos[id];
    custo = { valor: somaPesos, certeza: "hipotese" };
  } else {
    const total = rec.valor * custoPct.valor;
    for (const id of ids) cmv[id] = somaPesos > 0 ? (total * pesos[id]) / somaPesos : 0;
    custo = custoPct;
  }

  if (r.contratacoes === undefined) throw new RespostaInvalida("contratações por ano sem resposta");
  const contratacoes =
    r.contratacoes === NAO_SEI
      ? { fator: 1, certeza: "hipotese" as Certeza }
      : { fator: opcao(pacote.faixas.contratacoes, r.contratacoes, "contratações por ano"), certeza: "estimado" as Certeza };

  return { receita: rec, folha: folhaPct, custo, margem, partes, cmv, contratacoes };
}

/** Linhas de ganho por alavanca. `respostasNucleo` vazias = fator da resposta "não sei". */
function linhas(r: Respostas06, pacote: Pacote06, ret: Retrato): Linha06[] {
  const vermelhas = new Set(r.linhas_vermelhas ?? []);
  const folhaR = ret.receita.valor * ret.folha.valor;
  const fracRet = pacote.referencias.retaguarda_pct_folha;
  const nomeSeg = (id: string) => pacote.segmentos.find((s) => s.id === id)?.nome.toLowerCase() ?? id;

  return Object.entries(pacote.alavancas).map(([id, a]): Linha06 => {
    const linha: Linha06 = {
      alavanca: id,
      nome: a.nome,
      linha_dre: a.linha_dre,
      conservador: 0,
      base: 0,
      certeza: "medido",
      motivo_certeza: "",
      dado_deep: a.dado_deep,
      depende_de_vagas: Boolean(a.depende_de_vagas),
    };
    const bloqueio = pacote.linhas_vermelhas.find((l) => vermelhas.has(l.id) && l.bloqueia.includes(id));
    if (bloqueio) {
      linha.fora = `fora da conta: o cliente marcou "${bloqueio.nome}" como intocável`;
      return linha;
    }

    // Base da conta e o seu selo.
    let motivo = "";
    const marcar = (c: Certeza, porque: string) => {
      // O motivo mostrado é o da causa mais fraca (a que define o selo).
      const atual = ORDEM_CERTEZA[linha.certeza];
      if (ORDEM_CERTEZA[c] > atual || (ORDEM_CERTEZA[c] === atual && !motivo)) motivo = porque;
      linha.certeza = pior(linha.certeza, c);
    };
    const valorBase = (cen: 0 | 1): number => {
      const t = (x: AlavancaPacote["taxa"]) => (x ? x[cen] : 0);
      switch (a.base) {
        case "cmv_por_segmento":
          return Object.entries(ret.cmv).reduce((acc, [seg, v]) => acc + v * t(a.taxa_por_segmento?.[seg]), 0);
        case "cmv_total":
          return Object.values(ret.cmv).reduce((acc, v) => acc + v, 0) * t(a.taxa);
        case "folha_operacao":
          return folhaR * (1 - fracRet) * t(a.taxa);
        case "folha_retaguarda":
          return folhaR * fracRet * t(a.taxa);
        case "receita_segmentos":
          return ret.receita.valor * (a.segmentos ?? []).reduce((acc, s) => acc + (ret.partes[s] ?? 0), 0) * t(a.taxa);
      }
    };
    if (a.base === "cmv_por_segmento" || a.base === "cmv_total") {
      marcar(ret.custo.certeza, ret.custo.certeza === "hipotese" ? "peso dos insumos não informado (usa a referência do setor)" : ret.custo.certeza === "estimado" ? "peso dos insumos informado por faixa" : "peso dos insumos informado");
    } else if (a.base === "folha_operacao" || a.base === "folha_retaguarda") {
      marcar(ret.folha.certeza, ret.folha.certeza === "hipotese" ? "folha não informada (usa a referência do setor)" : ret.folha.certeza === "estimado" ? "folha informada por faixa" : "folha informada");
      if (a.base === "folha_retaguarda") marcar("estimado", "divisão entre operação e retaguarda pela referência do setor");
    } else {
      const parte = (a.segmentos ?? []).reduce((acc, s) => acc + (ret.partes[s] ?? 0), 0);
      if (parte === 0) {
        linha.fora = `não se aplica: sem receita de ${(a.segmentos ?? []).map(nomeSeg).join(" ou ")}`;
        return linha;
      }
      marcar(pior(ret.receita.certeza, "estimado"), "divisão da receita informada de forma aproximada");
    }

    // Resposta de aprofundamento: ajusta a taxa ao que a empresa já faz.
    let fator = 1;
    if (a.pergunta) {
      const p = pacote.perguntas[a.pergunta];
      const resposta = r.nucleo?.[a.pergunta];
      const escolhida = resposta !== undefined ? p.opcoes.find((o) => o.texto === resposta) : undefined;
      if (resposta !== undefined && !escolhida) throw new RespostaInvalida(`${p.texto}: '${resposta}' não é uma opção válida`);
      const usada = escolhida ?? p.opcoes.find((o) => o.hipotese) ?? { fator: 1, hipotese: true, texto: "", registro: false };
      fator = usada.fator;
      if (fator === 0) {
        linha.fora = `não se aplica: o cliente respondeu "${usada.texto}"`;
        return linha;
      }
      if (!escolhida) marcar("hipotese", "não perguntado no Self");
      else if (escolhida.hipotese) marcar("hipotese", `o cliente respondeu "${escolhida.texto}"`);
    }
    if (a.fator_contratacoes) {
      fator *= ret.contratacoes.fator;
      marcar(ret.contratacoes.certeza, ret.contratacoes.certeza === "hipotese" ? "contratações por ano não informadas" : "contratações por ano informadas por faixa");
    }
    if (a.taxa_sem_referencia) marcar("hipotese", "sem referência de mercado confiável para a taxa");

    linha.conservador = valorBase(0) * fator;
    linha.base = valorBase(1) * fator;
    linha.motivo_certeza = motivo || "base informada pelo cliente";
    return linha;
  });
}

/**
 * Perguntas de aprofundamento que o agente deve fazer: as das alavancas de
 * maior valor, com a dor escolhida sempre primeiro. Sem o retrato econômico
 * completo, devolve lista vazia (o agente ainda não chegou lá).
 */
export function aprofundar06(r: Respostas06, pacote: Pacote06, modelo: Modelo): string[] {
  let ret: Retrato;
  try {
    ret = retrato(r, pacote, modelo);
  } catch {
    return [];
  }
  const semNucleo = { ...r, nucleo: {} };
  const ls = linhas(semNucleo, pacote, ret).filter((l) => !l.fora && l.conservador > 0 && pacote.alavancas[l.alavanca].pergunta);
  const dor = pacote.dores.find((d) => d.id === r.dor)?.alavanca;
  ls.sort((a, b) => Number(b.alavanca === dor) - Number(a.alavanca === dor) || b.conservador - a.conservador);
  return ls.slice(0, pacote.aprofundar_max).map((l) => pacote.alavancas[l.alavanca].pergunta as string);
}

function prontidao(r: Respostas06, pacote: Pacote06, modelo: Modelo) {
  const p = pacote.prontidao;
  const respondidas = Object.entries(r.nucleo ?? {})
    .map(([id, texto]) => pacote.perguntas[id]?.opcoes.find((o) => o.texto === texto))
    .filter((o) => o !== undefined);
  const registros = respondidas.filter((o) => o.registro).length;
  const notas = {
    estrategia: opcao(p.patrocinio, r.patrocinio, "patrocínio e orçamento"),
    dados: respondidas.length > 0 ? 1 + (3 * registros) / respondidas.length : p.dados_sem_resposta,
    governanca: opcao(p.politica, r.politica, "regra escrita sobre IA e dados"),
    pessoas: opcao(p.uso_ia, r.uso_ia, "uso de IA hoje"),
  };
  const bruto =
    p.pesos.estrategia * ((notas.estrategia - 1) / 4) +
    p.pesos.dados * ((notas.dados - 1) / 4) +
    p.pesos.governanca * ((notas.governanca - 1) / 4) +
    p.pesos.pessoas * ((notas.pessoas - 1) / 4);
  // Mesmas travas do modelo: sem patrocínio ou sem dado, projetos de IA param no piloto.
  let teto: number | null = null;
  for (const t of modelo.travas) {
    const dims = t.dimensoes as ("estrategia" | "dados")[];
    if (dims.some((d) => notas[d] <= t.nota_max)) teto = teto === null ? t.teto : Math.min(teto, t.teto);
  }
  const score = teto !== null ? Math.min(bruto, teto) : bruto;
  return { score, nivel: nivel(score, modelo.niveis), teto, R: fatorR(score, modelo), notas };
}

function validarBasico(r: Respostas06, pacote: Pacote06) {
  if (r.formato !== FORMATO_06) throw new RespostaInvalida("formato de respostas diferente do Self 0.6");
  if (r.setor !== pacote.pacote) throw new RespostaInvalida(`setor '${String(r.setor)}' não corresponde ao pacote '${pacote.pacote}'`);
  const ids = pacote.linhas_vermelhas.map((l) => l.id);
  if (!r.linhas_vermelhas?.length) throw new RespostaInvalida("marque o que a IA nunca pode tocar (ou 'nada específico')");
  for (const l of r.linhas_vermelhas) if (!ids.includes(l)) throw new RespostaInvalida(`linha vermelha '${l}' desconhecida`);
  if (!pacote.dores.some((d) => d.id === r.dor)) throw new RespostaInvalida("escolha o problema para resolver em 6 semanas");
  for (const k of Object.keys(r.nucleo ?? {})) {
    if (!Object.hasOwn(pacote.perguntas, k)) throw new RespostaInvalida(`pergunta de aprofundamento '${k}' desconhecida`);
  }
}

export function calcularSelf06(r: Respostas06, pacote: Pacote06, modelo: Modelo): Resultado06 {
  validarBasico(r, pacote);
  const ret = retrato(r, pacote, modelo);
  const ls = linhas(r, pacote, ret);
  const ativas = ls.filter((l) => !l.fora);
  const total = {
    conservador: ativas.reduce((a, l) => a + l.conservador, 0),
    base: ativas.reduce((a, l) => a + l.base, 0),
  };
  const pront = prontidao(r, pacote, modelo);
  const lucro = ret.receita.valor * ret.margem.valor;
  const pctLucro = (v: number) => (lucro > 0 ? (v / lucro) * 100 : null);

  const alertas: Resultado06["alertas"] = [];
  if (pront.notas.governanca <= 1 && pront.notas.pessoas >= 2) {
    alertas.push({
      codigo: "ia_sem_politica",
      texto:
        "A empresa já usa IA sem uma regra escrita sobre IA e dados. Isso expõe dados de clientes e da empresa e é o primeiro ponto a resolver, antes de ampliar o uso.",
    });
  }
  if (ret.folha.valor + ret.custo.valor + ret.margem.valor > 0.95) {
    alertas.push({
      codigo: "soma_alta",
      texto:
        "Folha, insumos e margem somam mais de 95% da receita. Vale conferir se a margem informada é a líquida e se a folha inclui encargos.",
    });
  }
  const faixaPessoas = r.pessoas !== undefined && Object.hasOwn(modelo.self.faixas_pessoas_total, r.pessoas) ? modelo.self.faixas_pessoas_total[r.pessoas] : null;
  if (!faixaPessoas) throw new RespostaInvalida("número de pessoas sem resposta válida");
  const rpp = ret.receita.valor / meio(faixaPessoas);
  const [lo, hi] = modelo.self.receita_por_pessoa_plausivel;
  if (rpp < lo || rpp > hi) {
    alertas.push({
      codigo: "receita_por_pessoa",
      texto: "A receita por pessoa ficou fora do padrão do setor. Vale conferir o faturamento e o número de pessoas informados.",
    });
  }

  const vagas = ativas.filter((l) => l.depende_de_vagas).reduce((a, l) => a + l.conservador, 0);
  const dor = pacote.dores.find((d) => d.id === r.dor);
  if (!dor) throw new RespostaInvalida("problema de 6 semanas inválido");

  const incertas = ativas.filter((l) => l.certeza !== "medido" && l.conservador > 0).sort((a, b) => b.conservador - a.conservador);

  const g = pacote.regua;
  const investimento = Math.max(g.investimento_minimo_24m, ret.receita.valor * g.investimento_por_receita);
  const mudanca = investimento * g.custo_mudanca_por_investimento;
  const ganho24 = (total.conservador / 12) * g.meses_efetivos_24m;
  const retornoX = ganho24 / (investimento + mudanca);
  const veredito: Veredito = retornoX >= g.retorno_minimo_x ? "seguir" : retornoX >= g.retorno_deep_x ? "deep_para_confirmar" : "comecar_pequeno";

  const vermelhas = new Set(r.linhas_vermelhas ?? []);
  return {
    versoes: { motor: MOTOR_VERSAO_06, modelo: modelo.versao, pacote: `${pacote.pacote} ${pacote.versao}` },
    hash_respostas: hashRespostas(r as unknown as Respostas),
    formato: FORMATO_06,
    empresa: {
      receita: ret.receita.valor,
      receita_certeza: ret.receita.certeza,
      margem: ret.margem.valor,
      margem_certeza: ret.margem.certeza,
      lucro,
      folha: ret.receita.valor * ret.folha.valor,
      folha_certeza: ret.folha.certeza,
      custo: Object.values(ret.cmv).reduce((a, v) => a + v, 0),
      custo_certeza: ret.custo.certeza,
      pessoas: r.pessoas as string,
      contratacoes: r.contratacoes as string,
    },
    total,
    ano1: { conservador: total.conservador * pront.R, base: total.base * pront.R },
    pct_lucro: { conservador: pctLucro(total.conservador), base: pctLucro(total.base) },
    por_mes: total.conservador / 12,
    linhas: ls,
    linhas_vermelhas: pacote.linhas_vermelhas.filter((l) => vermelhas.has(l.id) && l.id !== "nenhuma").map(({ id, nome }) => ({ id, nome })),
    linhas_vermelhas_outro: r.linhas_vermelhas_outro?.trim() || null,
    bloqueadas: ls
      .filter((l) => l.fora?.startsWith("fora da conta"))
      .map((l) => ({ alavanca: l.alavanca, nome: l.nome, por: l.fora as string })),
    pessoas: {
      horas_liberadas: vagas,
      pct_do_ganho: total.conservador > 0 ? vagas / total.conservador : 0,
      contratacoes: r.contratacoes as string,
      bloqueado_por_quadro: vermelhas.has("quadro"),
    },
    ganho_rapido: {
      dor: dor.nome,
      ...dor.piloto,
      valor_alavanca: ls.find((l) => l.alavanca === dor.alavanca)?.conservador ?? 0,
    },
    prontidao: pront,
    alertas,
    deep: {
      itens: incertas.map((l) => ({ nome: l.nome, valor: l.conservador, certeza: l.certeza, dado: l.dado_deep })),
      valor_em_jogo: incertas.reduce((a, l) => a + l.conservador, 0),
    },
    regua: { investimento_24m: investimento, custo_mudanca_24m: mudanca, ganho_24m: ganho24, retorno_x: retornoX, veredito },
    riscos: pacote.riscos,
  };
}
