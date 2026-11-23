import { describe, expect, it } from "vitest";
import modelo from "@/lib/assessment/dados/modelo_comum.json";
import pacoteJson from "@/lib/assessment/v06/food_service.json";
import { aprofundar06, calcularSelf06 } from "@/lib/assessment/v06/motor";
import { pendencias06 } from "@/lib/assessment/v06/questionario";
import { eFormato06, montarQuestionario06, normalizarRascunho06 } from "@/lib/assessment/v06/self";
import { RespostaInvalida } from "@/lib/assessment/erros";
import type { Modelo } from "@/lib/assessment/tipos";
import type { Pacote06, Respostas06 } from "@/lib/assessment/v06/tipos";
import piloto from "../fixtures/assessment/respostas_piloto_06.json";

/**
 * Self 0.6 (skill do Self, 20/11/2026). Dados fictícios (Rede Piloto), com o
 * mesmo porte do teste real de 04/11 para conferir as taxas do pacote.
 */
const M = modelo as unknown as Modelo;
const P = pacoteJson as unknown as Pacote06;
const base = piloto as unknown as Respostas06;
const linha = (r: ReturnType<typeof calcularSelf06>, id: string) => r.linhas.find((l) => l.alavanca === id)!;

describe("motor 0.6: contas por alavanca", () => {
  const r = calcularSelf06(base, P, M);

  it("reproduz as taxas do relatório executivo (CMV, folha e receita)", () => {
    expect(linha(r, "desperdicio").conservador).toBeCloseTo(616_000, -3);
    expect(linha(r, "compras").conservador).toBeCloseTo(290_400, -2);
    expect(linha(r, "escala").conservador).toBeCloseTo(422_400, -2);
    expect(linha(r, "reservas").conservador).toBeCloseTo(99_000, -2);
    expect(linha(r, "giro").conservador).toBeCloseTo(141_900, -2);
    expect(r.total.conservador).toBeGreaterThan(1_900_000);
    expect(r.total.conservador).toBeLessThan(2_200_000);
    expect(r.total.base).toBeGreaterThan(r.total.conservador);
  });

  it("dá o selo de certeza pela base e pela resposta", () => {
    // Insumos informados com número exato, mas sobra não medida: hipótese.
    expect(linha(r, "desperdicio").certeza).toBe("hipotese");
    expect(linha(r, "compras").certeza).toBe("medido");
    // Retaguarda usa a divisão típica entre operação e retaguarda.
    expect(linha(r, "retaguarda").certeza).toBe("estimado");
    expect(linha(r, "eventos").fora).toMatch(/sem receita/);
    // Folha exata, mas contratações por faixa: estimado.
    expect(linha(r, "rotatividade").certeza).toBe("estimado");
  });

  it("mostra o ganho em % do lucro e o valor de cada mês", () => {
    expect(r.pct_lucro.conservador).toBeCloseTo((r.total.conservador / (110_000_000 * 0.075)) * 100, 6);
    expect(r.por_mes).toBeCloseTo(r.total.conservador / 12, 6);
    expect(r.ano1.conservador).toBeLessThan(r.total.conservador);
  });

  it("aplica a régua de 3× e diz a verdade quando não fecha", () => {
    // Rede Piloto (R$ 110 mi, R$ 2 mi conservador) com a tabela de 23/11: 1,8× em 24 meses.
    expect(r.regua.retorno_x).toBeGreaterThan(1.7);
    expect(r.regua.retorno_x).toBeLessThan(2);
    expect(r.regua.veredito).toBe("comecar_pequeno");
    const media = calcularSelf06({ ...base, receita_valor: 140_000_000 }, P, M);
    expect(media.regua.veredito).toBe("deep_para_confirmar");
    const grande = calcularSelf06({ ...base, receita_valor: 200_000_000, pessoas: "501 a 2.000" }, P, M);
    expect(grande.regua.veredito).toBe("seguir");
    const pequena = calcularSelf06({ ...base, receita_valor: 3_000_000, pessoas: "21 a 100" }, P, M);
    expect(pequena.regua.veredito).toBe("comecar_pequeno");
  });

  it("separa as horas que dependem de não repor vagas", () => {
    const esperado = linha(r, "retaguarda").conservador + linha(r, "reservas").conservador;
    expect(r.pessoas.horas_liberadas).toBeCloseTo(esperado, 6);
  });

  it("dá alerta de IA sem política", () => {
    expect(r.alertas.map((a) => a.codigo)).toContain("ia_sem_politica");
  });

  it("monta o ganho rápido a partir da dor", () => {
    expect(r.ganho_rapido.dor).toBe("Desperdício e sobra");
    expect(r.ganho_rapido.valor_alavanca).toBeCloseTo(linha(r, "desperdicio").conservador, 6);
  });

  it("lista no Deep o que não é medido, do maior para o menor", () => {
    const valores = r.deep.itens.map((i) => i.valor);
    expect([...valores].sort((a, b) => b - a)).toEqual(valores);
    expect(r.deep.itens.every((i) => i.certeza !== "medido")).toBe(true);
  });

  it("é determinístico", () => {
    expect(calcularSelf06(base, P, M)).toEqual(r);
  });
});

describe("motor 0.6: linhas vermelhas e respostas", () => {
  it("tira da conta o que o cliente marcou como intocável", () => {
    const r = calcularSelf06({ ...base, linhas_vermelhas: ["conversa_remota", "quadro"] }, P, M);
    expect(linha(r, "reservas").conservador).toBe(0);
    expect(linha(r, "retaguarda").conservador).toBe(0);
    expect(r.bloqueadas.map((b) => b.alavanca).sort()).toEqual(["reservas", "retaguarda"]);
    expect(r.pessoas.bloqueado_por_quadro).toBe(true);
  });

  it("'não sei' usa a referência do setor e vira hipótese", () => {
    const sem: Respostas06 = { ...base, folha: "não sei" };
    delete sem.folha_exata;
    const r = calcularSelf06(sem, P, M);
    expect(r.empresa.folha).toBeCloseTo(110_000_000 * P.referencias.folha_pct, 2);
    expect(linha(r, "escala").certeza).toBe("hipotese");
  });

  it("'não trabalhamos com reservas' zera a linha", () => {
    const r = calcularSelf06({ ...base, nucleo: { ...base.nucleo, reservas: "não trabalhamos com reservas" } }, P, M);
    expect(linha(r, "reservas").fora).toMatch(/não se aplica/);
  });

  it("recusa divisão que não soma 100% e opção inexistente", () => {
    expect(() => calcularSelf06({ ...base, divisao: { restaurantes: 50 } }, P, M)).toThrow(RespostaInvalida);
    expect(() => calcularSelf06({ ...base, nucleo: { sobra: "às vezes" } }, P, M)).toThrow(RespostaInvalida);
    expect(() => calcularSelf06({ ...base, linhas_vermelhas: [] }, P, M)).toThrow(RespostaInvalida);
  });
});

describe("aprofundamento", () => {
  it("pergunta primeiro a dor e depois as alavancas de maior valor", () => {
    const ids = aprofundar06({ ...base, dor: "compras", nucleo: {} }, P, M);
    expect(ids[0]).toBe("cotacao");
    expect(ids.length).toBe(P.aprofundar_max);
  });

  it("devolve vazio antes do retrato econômico", () => {
    expect(aprofundar06({ formato: "0.6", setor: "food_service" }, P, M)).toEqual([]);
  });
});

describe("questionário e rascunho 0.6", () => {
  const q = montarQuestionario06();

  it("não leva taxas para a tela", () => {
    const texto = JSON.stringify(q);
    expect(texto).not.toMatch(/taxa|0\.0125|fator/);
  });

  it("normaliza: grava formato e setor do servidor, exato vence faixa, nada específico sai", () => {
    const n = normalizarRascunho06(
      { formato: "0.5", setor: "outro", folha: "20 a 25%", folha_exata: 24, linhas_vermelhas: ["nenhuma", "preparo"], resultado: 1 },
      "food_service",
    );
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.respostas).toEqual({ formato: "0.6", setor: "food_service", folha_exata: 24, linhas_vermelhas: ["preparo"] });
  });

  it("recusa resposta fora da lista", () => {
    expect(normalizarRascunho06({ nucleo: { sobra: "às vezes" } }, "food_service").ok).toBe(false);
    expect(normalizarRascunho06({ folha: "40%" }, "food_service").ok).toBe(false);
  });

  it("aponta pendências e libera quando completo", () => {
    expect(pendencias06({}, {})).toContain("O que a IA nunca pode tocar");
    const empresa = { nome: "Rede Piloto", cnpj: "11222333000181", cidade: "São Paulo", uf: "SP", contato_nome: "Ana", contato_cargo: "CEO", contato_email: "ana@exemplo.com" };
    expect(pendencias06(base, empresa)).toEqual([]);
  });

  it("reconhece rascunho novo ou marcado como 0.6", () => {
    expect(eFormato06({})).toBe(true);
    expect(eFormato06({ setor: "food_service" })).toBe(true);
    expect(eFormato06({ formato: "0.6", folha: "não sei" })).toBe(true);
    expect(eFormato06({ q3: "21 a 100" })).toBe(false);
  });
});
