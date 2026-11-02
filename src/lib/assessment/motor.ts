/**
 * Motor de cálculo do Self assessment (porte fiel de referencia/assessment/motor.py).
 *
 * É o único lugar onde números são produzidos: mesmas respostas, mesmo
 * resultado, sempre (determinístico e versionado). Nenhuma LLM participa.
 *
 *   S = min(teto, Σ w_d × (n_d − 1) / 4)        score de sucesso
 *   R = 0,30 + 0,60 × S                          fator de captura em 12 meses
 *   P = R × (Σ FTE_a × C × e_a + Σ L_k)          retorno bruto anual
 *   Δmargem (p.p.) = P / Receita × 100
 *
 * Qualquer mudança aqui exige mudar MOTOR_VERSAO e regenerar os casos de
 * teste a partir do Python (referencia/assessment/gerar_casos.py).
 */
import { createHash } from "node:crypto";
import { RespostaInvalida } from "./erros";
import { ordenarAreasQ6 } from "./areas";
import { calcularFormula } from "./formula";
import type { Modelo, Pacote, Respostas, ResultadoSelf } from "./tipos";

export { RespostaInvalida } from "./erros";

export const MOTOR_VERSAO = "0.2.1";
/** O otimista nunca é mostrado ao cliente. */
type Cenario = "conservador" | "base";
const DIMENSOES = ["estrategia", "dados", "processos", "tecnologia", "governanca", "pessoas"] as const;
type Dimensao = (typeof DIMENSOES)[number];
type Notas = Record<Dimensao, number>;

// ---------------------------------------------------------------- utilidades

/**
 * Soma igual ao `sum()` do CPython 3.12+ (soma compensada de Neumaier), para
 * que TypeScript e Python cheguem ao mesmo número até a última casa.
 */
export function soma(valores: Iterable<number>): number {
  let f = 0;
  let c = 0;
  for (const x of valores) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  return c !== 0 && Number.isFinite(c) ? f + c : f;
}

/** Busca a opção na tabela; chave fora da lista (ou herdada do protótipo) é recusada. */
function opcao<T>(tabela: Readonly<Record<string, T>>, chave: unknown, pergunta: string): T {
  if (typeof chave !== "string" || !Object.hasOwn(tabela, chave)) {
    throw new RespostaInvalida(
      `${pergunta}: '${String(chave)}' não é uma opção válida (${Object.keys(tabela).join(", ")})`,
    );
  }
  return tabela[chave];
}

/** Conservador usa o limite inferior; base usa o ponto médio (regra do doc). */
function faixa(f: readonly [number, number], cenario: Cenario): number {
  const [lo, hi] = f;
  return cenario === "conservador" ? lo : (lo + hi) / 2;
}

function param(valor: unknown, cenario: Cenario): number {
  if (valor !== null && typeof valor === "object") {
    const v = valor as Record<string, unknown>;
    return (Object.hasOwn(v, cenario) ? v[cenario] : v.valor) as number;
  }
  return valor as number;
}

function numeroNaoNegativo(v: unknown, pergunta: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new RespostaInvalida(`${pergunta}: informe um número válido`);
  }
  return v;
}

/** JSON igual ao json.dumps(sort_keys=True, ensure_ascii=False) do Python, para o hash bater. */
function jsonPython(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonPython).join(", ")}]`;
  const obj = v as Record<string, unknown>;
  const chaves = Object.keys(obj).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}: ${jsonPython(obj[k])}`).join(", ")}}`;
}

export function hashRespostas(r: Respostas): string {
  return createHash("sha256").update(jsonPython(r), "utf8").digest("hex").slice(0, 16);
}

export function receita(r: Respostas, modelo: Modelo, cenario: Cenario): number {
  // Pergunta 2 (decisão de 02/11/2026): valor aproximado em R$; faixa só se o cliente preferir.
  const v = r.q2_valor;
  if (v !== undefined && v !== null) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new RespostaInvalida("pergunta 2: o faturamento precisa ser um valor positivo em R$");
    }
    return v;
  }
  if (r.q2 === undefined) throw new RespostaInvalida("pergunta 2 sem resposta");
  return faixa(opcao(modelo.self.faixas_receita, r.q2, "pergunta 2"), cenario);
}

export function nivel(score: number, niveis: Modelo["niveis"]): string {
  for (const [minimo, nome] of niveis) if (score >= minimo) return nome;
  return niveis[niveis.length - 1][1];
}

// ---------------------------------------------------------------- score

function notasDimensoes(r: Respostas, pacote: Pacote, modelo: Modelo) {
  const s = modelo.self;
  const grade = r.grade_q5 ?? {};
  const areasNota: Record<string, number> = {};
  for (const [a, v] of Object.entries(grade)) areasNota[a] = opcao(s.nota_q5, v, `pergunta 5 (${a})`);
  const faltando = [...modelo.areas_operacionais, "11_ti_seguranca"].filter((a) => !Object.hasOwn(areasNota, a));
  if (faltando.length > 0) throw new RespostaInvalida(`pergunta 5 sem resposta para: [${faltando.sort().map((a) => `'${a}'`).join(", ")}]`);

  const itens = pacote.pergunta_dados_D.itens;
  const dadosD = r.dados_D ?? {};
  const cob = itens.map((f) =>
    opcao(s.cobertura_fonte, Object.hasOwn(dadosD, f) ? dadosD[f] : "não sei", `pergunta D (${f})`),
  );
  const cobertura = soma(cob) / itens.length;
  const notaQ8 = opcao(s.nota_q8, r.q8, "pergunta 8");
  const notas: Notas = {
    estrategia: opcao(s.nota_q11, r.q11, "pergunta 11"),
    dados: (notaQ8 + 1 + 3 * cobertura) / 2,
    processos: soma(modelo.areas_operacionais.map((a) => areasNota[a])) / modelo.areas_operacionais.length,
    tecnologia: areasNota["11_ti_seguranca"],
    governanca: opcao(s.nota_q10, r.q10, "pergunta 10"),
    pessoas: opcao(s.nota_q9, r.q9, "pergunta 9"),
  };
  areasNota["01_estrategia"] = notas.estrategia;
  areasNota["02_dados"] = notas.dados;
  areasNota["03_pessoas"] = notas.pessoas;
  return { notas, areasNota, cobertura };
}

export function scoreSucesso(notas: Notas, modelo: Modelo): { valor: number; teto: number | null } {
  const bruto = soma(DIMENSOES.map((d) => (modelo.pesos_dimensoes[d] * (notas[d] - 1)) / 4));
  let teto: number | null = null;
  for (const t of modelo.travas) {
    // A trava mais restritiva que se aplica vence.
    if (t.dimensoes.some((d) => notas[d as Dimensao] <= t.nota_max)) teto = teto === null ? t.teto : Math.min(teto, t.teto);
  }
  return { valor: teto !== null ? Math.min(bruto, teto) : bruto, teto };
}

export function fatorR(score: number, modelo: Modelo): number {
  return modelo.fator_R.minimo + modelo.fator_R.amplitude * score;
}

// ---------------------------------------------------------------- retorno

function eA(area: string, pacote: Pacote, modelo: Modelo): Record<string, number> {
  const ajustado = pacote.areas.e_a_ajustado ?? {};
  const v = Object.hasOwn(ajustado, area) ? ajustado[area] : undefined;
  if (v && Object.keys(v).length > 0) return v;
  if (!Object.hasOwn(modelo.e_a_benchmark, area)) throw new RespostaInvalida(`área desconhecida: ${area}`);
  return modelo.e_a_benchmark[area];
}

/**
 * Áreas que a pergunta 6 vai perguntar: maior potencial esperado pelo setor.
 * Potencial = participação típica de pessoas × e_a base × espaço para evoluir (5 − nota).
 */
export function areasParaPergunta6(areasNota: Record<string, number>, pacote: Pacote, modelo: Modelo): string[] {
  return ordenarAreasQ6(candidatasQ6(modelo), pesosQ6(pacote, modelo), areasNota, modelo.self.areas_no_calculo);
}

/** Áreas que podem entrar na pergunta 6: operacionais e TI. */
export function candidatasQ6(modelo: Modelo): string[] {
  return [...modelo.areas_operacionais, "11_ti_seguranca"];
}

/** Peso de cada candidata: participação típica de pessoas × e_a base. */
export function pesosQ6(pacote: Pacote, modelo: Modelo): Record<string, number> {
  const dist = pacote.areas.distribuicao_tipica_pessoas;
  const pesos: Record<string, number> = {};
  for (const a of candidatasQ6(modelo)) {
    const d = Object.hasOwn(dist, a) && typeof dist[a] === "number" ? (dist[a] as number) : 0;
    pesos[a] = d * eA(a, pacote, modelo).base;
  }
  return pesos;
}

function retorno(r: Respostas, pacote: Pacote, modelo: Modelo, R: number, cenario: Cenario) {
  const s = modelo.self;
  const receitaC = receita(r, modelo, cenario);
  const C = pacote.parametros_padrao.C_custo_anual_por_pessoa.valor;

  const pessoas = Object.entries(r.pessoas_q6 ?? {}).map(([area, f]) => {
    const fte = faixa(opcao(s.faixas_pessoas_area, f, `pergunta 6 (${area})`), cenario);
    const ea = eA(area, pacote, modelo)[cenario];
    return { area, fte, e_a: ea, valor: fte * C * ea };
  });

  const setoriais = r.setoriais ?? {};
  const variaveis: Record<string, number> = {};
  for (const [k, v] of Object.entries(pacote.parametros_padrao)) variaveis[k] = v.valor;
  variaveis.receita_salao_delivery = receitaC;
  variaveis.lugares_total = numeroNaoNegativo(setoriais.lugares_total, "pergunta S1 (lugares)");
  variaveis.ticket_pessoa = faixa(opcao(s.faixas_ticket, setoriais.ticket_pessoa, "pergunta S2"), cenario);

  const alavancas = pacote.self_ordem_alavancas.slice(0, pacote.self_alavancas_max).map((nome) => {
    const a = pacote.alavancas[nome];
    const cond = a.condicao;
    if (cond && !cond.em.includes(setoriais[cond.campo] as string)) {
      return {
        alavanca: nome,
        nome: a.nome,
        linha_dre: a.linha_dre,
        valor: 0,
        motivo: `não calculada: ${cond.campo} = ${String(setoriais[cond.campo] ?? "None")}`,
      };
    }
    const locais: Record<string, number> = {};
    for (const [k, v] of Object.entries(a)) {
      if (v !== null && typeof v === "object" && !Array.isArray(v) && k !== "condicao") locais[k] = param(v, cenario);
    }
    const valor = calcularFormula(a.formula, { ...variaveis, ...locais });
    return { alavanca: nome, nome: a.nome, linha_dre: a.linha_dre, valor };
  });

  const brutoPessoas = soma(pessoas.map((p) => p.valor));
  const brutoAlavancas = soma(alavancas.map((a) => a.valor));
  const P = R * (brutoPessoas + brutoAlavancas);
  return {
    receita_usada: receitaC,
    pessoas,
    alavancas,
    potencial_bruto: brutoPessoas + brutoAlavancas,
    R,
    P,
    // 0.2.1: faixa "até 4,8 mi" tem limite inferior 0; sem receita não há margem a mostrar.
    delta_margem_pp: receitaC > 0 ? (P / receitaC) * 100 : null,
  };
}

// ---------------------------------------------------------------- validações

function validarCoerencia(r: Respostas, modelo: Modelo): string[] {
  const s = modelo.self;
  const [loTot, hiTot] = opcao(s.faixas_pessoas_total, r.q3, "pergunta 3");
  const q6 = r.pessoas_q6 ?? {};
  const somaLo = soma(Object.values(q6).map((f) => opcao(s.faixas_pessoas_area, f, "pergunta 6")[0]));
  if (somaLo > hiTot) throw new RespostaInvalida(`pessoas nas áreas (${somaLo}+) passam do total da empresa (até ${hiTot})`);
  if (Object.keys(q6).length > s.areas_no_calculo) {
    throw new RespostaInvalida(`pergunta 6 aceita no máximo ${s.areas_no_calculo} áreas`);
  }
  const avisos: string[] = [];
  const rpp = receita(r, modelo, "base") / ((loTot + hiTot) / 2);
  const [lo, hi] = s.receita_por_pessoa_plausivel;
  if (!(lo <= rpp && rpp <= hi)) {
    avisos.push(
      `receita por pessoa de R$ ${Number(rpp.toFixed(0)).toLocaleString("en-US")} fora do padrão; o agente deve confirmar antes de mostrar`,
    );
  }
  return avisos;
}

// ---------------------------------------------------------------- orquestração

export function calcularSelf(r: Respostas, pacote: Pacote, modelo: Modelo): ResultadoSelf {
  if (r.setor !== pacote.pacote) {
    throw new RespostaInvalida(`setor '${String(r.setor)}' não corresponde ao pacote '${pacote.pacote}'`);
  }
  const avisos = validarCoerencia(r, modelo);
  const { notas, areasNota, cobertura } = notasDimensoes(r, pacote, modelo);
  const { valor: S, teto } = scoreSucesso(notas, modelo);
  const R = fatorR(S, modelo);
  const cen = { conservador: retorno(r, pacote, modelo, R, "conservador"), base: retorno(r, pacote, modelo, R, "base") };

  // O que destrava mais valor: subir 1 ponto em cada dimensão e ver o efeito no score e no retorno.
  const destrava = [];
  for (const d of DIMENSOES) {
    const n2 = { ...notas, [d]: Math.min(notas[d] + 1, modelo.nota_max_self) };
    const { valor: S2 } = scoreSucesso(n2, modelo);
    if (S2 > S) {
      const P2 = fatorR(S2, modelo) * cen.conservador.potencial_bruto;
      destrava.push({ dimensao: d, score_novo: S2, ganho_score_pp: (S2 - S) * 100, ganho_retorno: P2 - cen.conservador.P });
    }
  }
  destrava.sort((a, b) => b.ganho_score_pp - a.ganho_score_pp);

  // Top 3 oportunidades, com exemplo concreto do pacote do setor.
  const casos = pacote.casos_de_uso ?? [];
  const comps: [string, string, number][] = [
    ...cen.conservador.pessoas.map((p): [string, string, number] => [p.area, "e_a", p.valor * R]),
    ...cen.conservador.alavancas
      .filter((a) => a.valor > 0)
      .map((a): [string, string, number] => [a.alavanca, a.alavanca, a.valor * R]),
  ];
  const top3 = [...comps]
    .sort((a, b) => b[2] - a[2])
    .slice(0, 3)
    .map(([chave, , valor]) => {
      const ex = casos.find((c) => (c.area === chave && c.alavanca === "e_a") || c.alavanca === chave);
      return { origem: chave, valor_conservador: valor, exemplo: ex ? ex.nome : null };
    });

  const dadosD = r.dados_D ?? {};
  const mapa = pacote.pergunta_dados_D.itens.map((fid) => {
    const f = pacote.catalogo_fontes[fid];
    const st = Object.hasOwn(dadosD, fid) ? dadosD[fid] : "não sei";
    const item: ResultadoSelf["mapa_de_dados"][number] = { fonte: fid, nome: f.nome, situacao: st };
    if (st === "não tem" || st === "parcial") {
      item.como_criar = f.se_faltar;
      item.criar_fonte_com_ia = Boolean(f.criar_fonte);
    }
    return item;
  });

  return {
    versoes: { motor: MOTOR_VERSAO, modelo: modelo.versao, pacote: `${pacote.pacote} ${pacote.versao}` },
    hash_respostas: hashRespostas(r),
    avisos,
    precisao_receita: r.q2_valor !== undefined && r.q2_valor !== null ? "informada" : "faixa (menor precisão)",
    score: {
      valor: S,
      teto_aplicado: teto,
      nivel: nivel(S, modelo.niveis),
      nota_prontidao: soma(DIMENSOES.map((d) => modelo.pesos_dimensoes[d] * notas[d])),
      dimensoes: notas,
      cobertura_fontes: cobertura,
      ressalva: "Índice fundamentado, não probabilidade estatística, até calibrar com projetos reais.",
    },
    score_por_area: areasNota,
    areas_sugeridas_q6: areasParaPergunta6(areasNota, pacote, modelo),
    retorno: cen,
    top3,
    o_que_destrava: destrava.slice(0, 1),
    mapa_de_dados: mapa,
  };
}
