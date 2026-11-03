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
    // O resultado do piloto foi gerado na versão 0.2.0; só a versão do motor muda.
    const esperado = { ...resultadoPiloto, versoes: { ...resultadoPiloto.versoes, motor: MOTOR_VERSAO } };
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
