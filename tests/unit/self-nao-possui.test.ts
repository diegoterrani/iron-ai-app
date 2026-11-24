import { describe, expect, it } from "vitest";
import modelo from "@/lib/assessment/dados/modelo_comum.json";
import type { Modelo } from "@/lib/assessment/tipos";
import { calcularSelf06 } from "@/lib/assessment/v06/motor";
import { pendencias06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import { completarComNaoSei, montarQuestionario06, normalizarRascunho06, pacote06, paraMotor06 } from "@/lib/assessment/v06/self";
import { NAO_SEI, rotuloOpcao, type Respostas06 } from "@/lib/assessment/v06/tipos";

const q = montarQuestionario06();
const M = modelo as unknown as Modelo;
const empresa = {
  nome: "Rede Teste",
  cnpj: "11222333000181",
  cidade: "São Paulo",
  uf: "SP",
  contato_nome: "Ana",
  contato_cargo: "CEO",
  contato_email: "ana@exemplo.com",
};
/** Só o que o motor não sabe estimar: faturamento, pessoas, divisão e problema de 6 semanas. */
const minimo: Rascunho06 = {
  receita_valor: 100_000_000,
  pessoas: q.opcoes.pessoas[2],
  divisao: { [q.segmentos[0].id]: 100 },
  dor: q.dores[0].id,
};

describe("Não possui essa informação", () => {
  it("aparece em folha, insumos, margem, contratações e prontidão, e o rótulo troca só na tela", () => {
    for (const lista of [q.opcoes.folha, q.opcoes.custo, q.opcoes.margem, q.opcoes.contratacoes, q.opcoes.usoIa, q.opcoes.politica, q.opcoes.patrocinio]) {
      expect(lista).toContain(NAO_SEI);
    }
    expect(rotuloOpcao(NAO_SEI)).toBe("Não possui essa informação");
    expect(rotuloOpcao("sim")).toBe("sim");
  });

  it("linhas vermelhas aceitam 'não sei' sozinho; com outra marcação ele sai", () => {
    const so = normalizarRascunho06({ linhas_vermelhas: [NAO_SEI] }, "food_service");
    expect(so.ok && so.respostas.linhas_vermelhas).toEqual([NAO_SEI]);
    const junto = normalizarRascunho06({ linhas_vermelhas: [NAO_SEI, "receitas"] }, "food_service");
    expect(junto.ok && junto.respostas.linhas_vermelhas).toEqual(["receitas"]);
  });

  it("paraMotor06 leva 'não sei' de linhas vermelhas a 'nada específico' e da prontidão ao nível mais baixo", () => {
    const r = paraMotor06({ formato: "0.6", setor: "food_service", linhas_vermelhas: [NAO_SEI], uso_ia: NAO_SEI, politica: NAO_SEI, patrocinio: NAO_SEI } as Respostas06);
    expect(r.linhas_vermelhas).toEqual(["nenhuma"]);
    expect(pacote06.prontidao.uso_ia[r.uso_ia as string]).toBe(1);
    expect(pacote06.prontidao.politica[r.politica as string]).toBe(1);
    expect(pacote06.prontidao.patrocinio[r.patrocinio as string]).toBe(1);
  });

  it("completar não mexe no que foi respondido e deixa os quatro obrigatórios pendentes", () => {
    const c = completarComNaoSei({ folha_exata: 30, uso_ia: "pilotos" });
    expect(c.folha).toBeUndefined();
    expect(c.folha_exata).toBe(30);
    expect(c.uso_ia).toBe("pilotos");
    expect(c.custo).toBe(NAO_SEI);
    expect(pendencias06(c, empresa)).toEqual(["Faturamento anual", "Número de pessoas", "Divisão da receita por negócio", "Problema para resolver em 6 semanas"]);
  });

  it("com só os quatro obrigatórios, o motor calcula o relatório inteiro com selo de hipótese", () => {
    const norm = normalizarRascunho06(completarComNaoSei(minimo), "food_service");
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;
    expect(pendencias06(norm.respostas, empresa)).toEqual([]);
    const res = calcularSelf06(paraMotor06(norm.respostas as Respostas06), pacote06, M);
    expect(res.linhas.length).toBeGreaterThan(0);
    expect(res.linhas.some((l) => l.certeza === "hipotese")).toBe(true);
  });
});
