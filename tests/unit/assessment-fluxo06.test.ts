import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer } from "@react-pdf/renderer";
import modelo from "@/lib/assessment/dados/modelo_comum.json";
import pacoteJson from "@/lib/assessment/v06/food_service.json";
import { FASES_PILOTO, ROTULOS, percentuaisInteiros, retratoDre, textoInvestimento, textoPessoas } from "@/lib/assessment/v06/apresentacao";
import { fluxoCaixa, type PrecosReferencia } from "@/lib/assessment/v06/fluxo";
import { MOTOR_VERSAO_06, calcularSelf06 } from "@/lib/assessment/v06/motor";
import { RelatorioPdf06 } from "@/lib/assessment/v06/pdf/relatorio-pdf";
import { Relatorio06 } from "@/app/(app)/assessment/[id]/resultado/relatorio-06";
import type { Modelo } from "@/lib/assessment/tipos";
import type { Pacote06, Respostas06, Resultado06 } from "@/lib/assessment/v06/tipos";
import piloto from "../fixtures/assessment/respostas_piloto_06.json";
import { textoDasPaginas } from "./pdf-texto";

/**
 * Ajustes do motor 0.7.0 / pacote food_service 0.5.0 (23/11/2026), M1 a M5.
 * Só dados fictícios (Rede Piloto e números redondos do deck).
 */
const P = pacoteJson as unknown as Pacote06;
const M = modelo as unknown as Modelo;
const r = calcularSelf06(piloto as unknown as Respostas06, P, M);

/** Exemplo do deck: ganho de cruzeiro R$ 2,45 mi/ano, Onda 1 no mês 6 e Onda 2 no mês 9. */
const ONDAS_DECK = [
  { id: "onda1", inicio: 3, go_live: 6, ganho_anual: 1_050_000 },
  { id: "onda2", inicio: 6, go_live: 9, ganho_anual: 1_400_000 },
];
const comOnda = (preco: number): PrecosReferencia => ({ ...P.regua.precos, onda: { ...P.regua.precos.onda, preco } });

describe("M1: fluxo de caixa de 24 meses", () => {
  it("reproduz a conta de referência (onda de R$ 170 mil, prontidão de 100%)", () => {
    const f = fluxoCaixa(comOnda(170_000), ONDAS_DECK, 1);
    expect(f.investido).toBe(1_176_500);
    expect(f.ganho).toBe(3_325_000);
    expect(f.retorno_x).toBeCloseTo(2.8, 1);
    expect(f.cruzamento_mes).toBe(10);
    expect(f.exposicao_max).toBe(165_541);
  });

  it("com a tabela do pacote (onda de R$ 360 mil) bate com o deck v11", () => {
    expect(P.regua.precos.onda.preco).toBe(360_000);
    const f = fluxoCaixa(P.regua.precos, ONDAS_DECK, 1);
    expect(f.investido).toBe(1_556_500);
    expect(f.investido_iron + f.tecnologia).toBe(f.investido);
    expect(f.tecnologia).toBe(525_000);
    expect(f.ganho).toBe(3_325_000);
    expect(f.retorno_x).toBeCloseTo(2.14, 2);
    expect(f.cruzamento_mes).toBe(13);
    expect(f.exposicao_max).toBe(304_700);
    expect(f.sobra_socios).toBe(Math.round((3_325_000 - 1_556_500) * 0.66));
  });

  it("acumulados nunca diminuem e o Deep é pago nos meses 1 e 2", () => {
    const f = fluxoCaixa(P.regua.precos, ONDAS_DECK);
    expect(f.meses).toHaveLength(24);
    expect(f.meses[0].investido_acum).toBe(31_500);
    expect(f.meses[1].investido_acum).toBe(63_000);
    for (let i = 1; i < f.meses.length; i++) {
      expect(f.meses[i].investido_acum).toBeGreaterThanOrEqual(f.meses[i - 1].investido_acum);
      expect(f.meses[i].ganho_acum).toBeGreaterThanOrEqual(f.meses[i - 1].ganho_acum);
    }
  });

  it("prontidão escala o ganho; onda sem ganho não é contratada", () => {
    expect(fluxoCaixa(P.regua.precos, ONDAS_DECK, 0.5).ganho).toBe(1_662_500);
    const so1 = fluxoCaixa(P.regua.precos, [ONDAS_DECK[0], { ...ONDAS_DECK[1], ganho_anual: 0 }]);
    expect(so1.tecnologia).toBe(15_000 * 19);
    const nada = fluxoCaixa(P.regua.precos, []);
    expect(nada.investido).toBe(63_000);
    expect(nada.retorno_x).toBe(0);
    expect(nada.cruzamento_mes).toBeNull();
  });

  it("recusa tabela ou datas inválidas", () => {
    expect(() => fluxoCaixa(comOnda(-1), ONDAS_DECK)).toThrow();
    expect(() => fluxoCaixa(P.regua.precos, [{ ...ONDAS_DECK[0], go_live: 2 }])).toThrow();
    expect(() => fluxoCaixa(P.regua.precos, ONDAS_DECK, 1.5)).toThrow();
  });

  it("o motor usa o fluxo: cada alavanca em uma onda e o veredito pelo retorno de 24 meses", () => {
    expect(MOTOR_VERSAO_06).toBe("0.7.0");
    expect(r.versoes.pacote).toBe("food_service 0.5.0");
    const todas = P.regua.ondas.flatMap((o) => o.alavancas).sort();
    expect(todas).toEqual(Object.keys(P.alavancas).sort());
    const f = r.regua.fluxo!;
    expect(f.ondas.reduce((a, o) => a + o.ganho_anual, 0)).toBeCloseTo(r.total.conservador, 2);
    expect(r.regua.investimento_24m).toBe(f.investimento_iron_24m + f.tecnologia_24m);
    expect(r.regua.custo_mudanca_24m).toBeUndefined();
    const esperado = r.regua.retorno_x >= 3 ? "seguir" : r.regua.retorno_x >= 2 ? "deep_para_confirmar" : "comecar_pequeno";
    expect(r.regua.veredito).toBe(esperado);
  });

  it("texto do investimento de referência separa IRON e tecnologia", () => {
    expect(textoInvestimento(r)).toBe("Investimento de referência em 24 meses: R$ 1,6 mi (IRON R$ 1 mi + tecnologia R$ 525 mil)");
    const antigo = { ...r, regua: { ...r.regua, fluxo: undefined, custo_mudanca_24m: 1 } } as Resultado06;
    expect(textoInvestimento(antigo)).toBeNull();
  });
});

/** Relatório HTML como texto puro, para conferir rótulos. */
const textoHtml = (res: Resultado06) =>
  renderToStaticMarkup(createElement(Relatorio06, { r: res, assessmentId: "00000000-0000-0000-0000-000000000000" }))
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

describe("M2: quanto o atraso adia", () => {
  it("tela traz os dois rótulos novos e a frase do ritmo de cruzeiro", () => {
    const linhas = textoHtml(r);
    const i = linhas.indexOf(ROTULOS.kpiAtraso);
    expect(linhas.slice(i, i + 3)).toMatchInlineSnapshot(`
      [
        "Cada mês de atraso",
        "R$ 170 mil",
        "de ganho adiado, em ritmo de cruzeiro",
      ]
    `);
    const j = linhas.indexOf(ROTULOS.blocoAtraso);
    expect(linhas.slice(j, j + 12)).toMatchInlineSnapshot(`
      [
        "Quanto o atraso adia",
        "3 meses",
        "R$ 511 mil",
        "6 meses",
        "R$ 1 mi",
        "12 meses",
        "R$ 2 mi",
        "Valores em ritmo de cruzeiro: cada mês de atraso é um mês a menos de ganho.",
        "No primeiro ano, com a prontidão de hoje, a captura estimada é de R$ 1,1 mi.",
        "Onde o ganho cai no seu DRE",
        "Folha com encargos: 24% (R$ 26,4 mi)",
        "Insumos: 35% (R$ 38,7 mi)",
      ]
    `);
    const html = linhas.join(" ");
    expect(html).not.toContain("sem agir");
    expect(html).not.toContain("custo de esperar");
    expect(html).not.toContain("fica na mesa");
  });
});

describe("M3: texto de Pessoas", () => {
  it("diz que ninguém é demitido e quanto fica se repuser todas as vagas", () => {
    const res = { ...r, total: { ...r.total, conservador: 3_600_000 }, pessoas: { ...r.pessoas, horas_liberadas: 578_000, pct_do_ganho: 578_000 / 3_600_000 } };
    expect(textoPessoas(res)).toBe(
      "16% do ganho (R$ 578 mil por ano) vem de horas liberadas na retaguarda e no atendimento remoto. " +
        "Ninguém é demitido: o ganho vem de hora extra, retrabalho e de vagas que já abrem com a rotatividade. " +
        "Repor ou não cada vaga é sempre decisão da empresa; se preferir repor todas, o ganho conservador fica em R$ 3 mi.",
    );
  });
});

describe("M4: percentuais do DRE", () => {
  it("caso de referência 45,4 / 66 / 41,2 / 12,4 sobre 165 dá 27 / 40 / 25 / 8", () => {
    const res = { ...r, empresa: { ...r.empresa, receita: 165e6, folha: 45.4e6, custo: 66e6, lucro: 12.4e6 } };
    expect(retratoDre(res).map((f) => [f.id, f.pct])).toEqual([
      ["folha", 27],
      ["custo", 40],
      ["outros", 25],
      ["lucro", 8],
    ]);
  });

  it("propriedade: soma 100 em 1000 entradas aleatórias, e o lucro é o resto", () => {
    // Gerador determinístico (LCG) para o teste ser reproduzível.
    let semente = 20261123;
    const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 1000; k++) {
      const receita = 1e6 + aleatorio() * 500e6;
      const folha = receita * aleatorio() * 0.5;
      const custo = (receita - folha) * aleatorio() * 0.8;
      const lucro = (receita - folha - custo) * aleatorio();
      const dre = retratoDre({ ...r, empresa: { ...r.empresa, receita, folha, custo, lucro } });
      expect(dre.reduce((a, f) => a + f.pct, 0)).toBe(100);
      for (const f of dre) expect(Math.abs(f.pct - f.fracao * 100)).toBeLessThan(1);
      const custos = dre.filter((f) => f.id !== "lucro").reduce((a, f) => a + f.pct, 0);
      const l = dre.find((f) => f.id === "lucro");
      if (l) expect(l.pct).toBe(100 - custos);
    }
  });

  it("maior resto também vale para listas soltas", () => {
    expect(percentuaisInteiros([1, 1, 1])).toEqual([33, 33, 34]);
    expect(percentuaisInteiros([0, 0])).toEqual([0, 0]);
    expect(percentuaisInteiros([5, -1, 5])).toEqual([50, 0, 50]);
  });
});

describe("M5: linha do tempo do piloto", () => {
  it("fases com linha de base de 2 semanas assinada pelo financeiro", () => {
    expect(FASES_PILOTO.map((f) => `${f.semanas} · ${f.titulo}`)).toEqual([
      "Semanas 1 e 2 · Linha de base, assinada pelo financeiro",
      "Semanas 3 a 6 · Piloto",
      "Semana 6 · Resultado medido",
    ]);
  });

  it("snapshot da página 3 do PDF e do bloco do ganho rápido", async () => {
    const buf = await renderToBuffer(RelatorioPdf06({ r, cab: { empresa: "Rede Piloto", calculadoEm: "2026-11-20T18:00:00Z" } }));
    const paginas = textoDasPaginas(buf);
    expect(paginas.length).toBeGreaterThanOrEqual(3);
    expect(paginas[2]).toMatchSnapshot();
    const todas = paginas.join("\n");
    const ini = todas.indexOf("SEMANAS 1 E 2");
    expect(todas.slice(ini, todas.indexOf("Nasce do problema", ini)).replace(/\s+/g, " ").trim()).toMatchInlineSnapshot(`"SEMANAS 1 E 2 Linha de base, assinada pelo financeiro Medimos o indicador como ele está hoje. SEMANAS 3 A 6 Piloto A IA entra no processo escolhido, com a equipe aprovando cada passo. SEMANA 6 Resultado medido Comparamos com a linha de base e decidimos o próximo passo."`);
  }, 30_000);
});
