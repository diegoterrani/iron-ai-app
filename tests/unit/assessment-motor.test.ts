import { describe, expect, it } from "vitest";
import modelo from "@/lib/assessment/dados/modelo_comum.json";
import pacote from "@/lib/assessment/dados/food_service.json";
import { calcularFormula } from "@/lib/assessment/formula";
import { MOTOR_VERSAO, RespostaInvalida, calcularSelf, soma } from "@/lib/assessment/motor";
import type { Modelo, Pacote, Respostas } from "@/lib/assessment/tipos";
import casos from "../fixtures/assessment/casos.json";
import respostasPiloto from "../fixtures/assessment/respostas_piloto_self.json";
import resultadoPiloto from "../fixtures/assessment/resultado_piloto_self.json";

/**
 * Testes-ouro: o motor TypeScript precisa dar o mesmo resultado que o motor
 * Python de referência (referencia/assessment/motor.py). Os casos sorteados
 * são gerados por referencia/assessment/gerar_casos.py.
 */
const M = modelo as unknown as Modelo;
const P = pacote as unknown as Pacote;

/** Compara recursivamente; números com tolerância de 1e-9 relativa (bem abaixo de R$ 1). */
function comparar(ts: unknown, py: unknown, caminho = "$"): string[] {
  if (typeof py === "number" && typeof ts === "number") {
    const tol = Math.max(1e-9, Math.abs(py) * 1e-12);
    return Math.abs(ts - py) <= tol ? [] : [`${caminho}: ${ts} != ${py}`];
  }
  if (Array.isArray(py)) {
    if (!Array.isArray(ts) || ts.length !== py.length) return [`${caminho}: lista diferente`];
    return py.flatMap((v, i) => comparar(ts[i], v, `${caminho}[${i}]`));
  }
  if (py !== null && typeof py === "object") {
    if (ts === null || typeof ts !== "object") return [`${caminho}: objeto ausente`];
    const a = ts as Record<string, unknown>;
    const b = py as Record<string, unknown>;
    const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...chaves].flatMap((k) => comparar(a[k], b[k], `${caminho}.${k}`));
  }
  return ts === py ? [] : [`${caminho}: ${JSON.stringify(ts)} != ${JSON.stringify(py)}`];
}

describe("motor do Self assessment", () => {
  it("usa a mesma versão que os casos gerados pelo Python", () => {
    expect(casos.motor).toBe(MOTOR_VERSAO);
  });

  it("reproduz o piloto Rede Piloto Alfa (score 35%, R$ 289 mil/ano conservador)", () => {
    const r = calcularSelf(respostasPiloto as unknown as Respostas, P, M);
    // O resultado do piloto foi gerado na versão 0.2.0; só as versões do motor e do pacote mudam.
    const esperado = { ...resultadoPiloto, versoes: r.versoes };
    expect(comparar(r, esperado)).toEqual([]);
    expect(Math.round(r.score.valor * 100)).toBe(35);
    expect(Math.round(r.retorno.conservador.P)).toBe(289154);
  });

  it(`bate com o Python nos ${casos.casos.length} casos sorteados, inclusive nos inválidos`, () => {
    const divergencias: string[] = [];
    for (const c of casos.casos) {
      const r = c.respostas as unknown as Respostas;
      if ("erro" in c) {
        let msg = "não recusou";
        try {
          calcularSelf(r, P, M);
        } catch (e) {
          msg = e instanceof RespostaInvalida ? e.message : `erro inesperado: ${String(e)}`;
        }
        if (msg !== c.erro) divergencias.push(`caso ${c.id}: ${msg} != ${c.erro}`);
      } else {
        divergencias.push(...comparar(calcularSelf(r, P, M), c.resultado, `caso ${c.id}`));
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("é determinístico: mesmas respostas, mesmo resultado e mesmo hash", () => {
    const r = respostasPiloto as unknown as Respostas;
    expect(calcularSelf(r, P, M)).toEqual(calcularSelf(structuredClone(r), P, M));
  });

  it("recusa opção herdada do protótipo em vez de aceitá-la", () => {
    const r = { ...(respostasPiloto as unknown as Respostas), q8: "constructor" };
    expect(() => calcularSelf(r, P, M)).toThrow(RespostaInvalida);
  });

  it("recusa número de lugares inválido", () => {
    const base = respostasPiloto as unknown as Respostas;
    const r = { ...base, setoriais: { ...base.setoriais, lugares_total: -5 } };
    expect(() => calcularSelf(r, P, M)).toThrow(RespostaInvalida);
  });
});

describe("tipos de unidade (motor 0.4.0)", () => {
  const base = respostasPiloto as unknown as Respostas;
  const s = base.setoriais as { unidades: number; lugares_total: number; ticket_pessoa: string; fila_pico: string };
  const restaurante = {
    segmento: "restaurantes",
    quantidade: s.unidades,
    participacao_receita: 100,
    lugares_total: s.lugares_total,
    ticket_pessoa: s.ticket_pessoa,
    fila_pico: s.fila_pico,
  };

  it("só restaurante com 100% da receita dá o mesmo retorno do formato antigo", () => {
    const antigo = calcularSelf(base, P, M);
    const novo = calcularSelf({ ...base, unidades: [restaurante] }, P, M);
    expect(novo.retorno.conservador.P).toBe(antigo.retorno.conservador.P);
    expect(novo.retorno.base.P).toBe(antigo.retorno.base.P);
    expect(novo.score).toEqual(antigo.score);
  });

  it("calcula o caso do teste de mesa: 7 restaurantes e 8 cozinhas de hospital", () => {
    const r: Respostas = {
      ...base,
      setoriais: undefined,
      unidades: [
        { ...restaurante, quantidade: 7, participacao_receita: 60 },
        { segmento: "institucional", quantidade: 8, participacao_receita: 40, refeicoes_dia: 6000 },
      ],
    };
    const res = calcularSelf(r, P, M);
    const [cmv, giro] = res.retorno.conservador.alavancas;
    // CMV roda nos dois tipos, cada um com o seu CMV; giro de mesas só no restaurante.
    expect(cmv.por_unidade?.map((u) => u.segmento)).toEqual(["restaurantes", "institucional"]);
    expect(giro.por_unidade?.map((u) => u.segmento)).toEqual(["restaurantes"]);
    const receita = res.retorno.conservador.receita_usada;
    expect(cmv.por_unidade?.[1].valor).toBeCloseTo(receita * 0.4 * 0.4 * 0.01, 6);
  });

  it("só cozinhas institucionais: giro de mesas não se aplica", () => {
    const r: Respostas = {
      ...base,
      unidades: [{ segmento: "institucional", quantidade: 3, participacao_receita: 100, refeicoes_dia: 2000 }],
    };
    const giro = calcularSelf(r, P, M).retorno.conservador.alavancas[1];
    expect(giro.valor).toBe(0);
    expect(giro.motivo).toBe("não se aplica aos tipos de unidade informados");
  });

  it.each([
    ["lista vazia", []],
    ["segmento a construir", [{ segmento: "hotelaria", quantidade: 1, participacao_receita: 100 }]],
    ["soma diferente de 100%", [{ segmento: "institucional", quantidade: 1, participacao_receita: 70, refeicoes_dia: 10 }]],
    ["quantidade fracionada", [{ segmento: "institucional", quantidade: 1.5, participacao_receita: 100, refeicoes_dia: 10 }]],
    ["segmento herdado do protótipo", [{ segmento: "constructor", quantidade: 1, participacao_receita: 100 }]],
  ])("recusa %s", (_nome, unidades) => {
    expect(() => calcularSelf({ ...base, unidades: unidades as Respostas["unidades"] }, P, M)).toThrow(RespostaInvalida);
  });
});

describe("soma compensada (igual ao sum() do Python 3.12+)", () => {
  it("não perde precisão onde a soma ingênua perde", () => {
    expect(soma([0.1, 0.2, 0.3])).toBe(0.6);
    expect(soma([1e16, 1, -1e16])).toBe(1);
  });
});

describe("fórmulas dos pacotes", () => {
  it("respeita precedência e parênteses", () => {
    expect(calcularFormula("a + b * c", { a: 1, b: 2, c: 3 })).toBe(7);
    expect(calcularFormula("(a + b) * c", { a: 1, b: 2, c: 3 })).toBe(9);
    expect(calcularFormula("a * (b - c) / 2", { a: 4, b: 10, c: 6 })).toBe(8);
  });

  it("recusa qualquer coisa além de aritmética", () => {
    for (const f of ["a ** 2", "-a", "f(a)", "a.b", "a; b", "a[0]", "process", "a +", "(a", "'x'"]) {
      expect(() => calcularFormula(f, { a: 1, b: 2 }), f).toThrow();
    }
  });

  it("não lê variáveis do protótipo", () => {
    expect(() => calcularFormula("toString + 1", {})).toThrow(RespostaInvalida);
  });

  it("recusa divisão por zero", () => {
    expect(() => calcularFormula("a / b", { a: 1, b: 0 })).toThrow();
  });
});
