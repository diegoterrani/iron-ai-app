import { describe, expect, it } from "vitest";
import modelo from "@/lib/assessment/dados/modelo_comum.json";
import pacote from "@/lib/assessment/dados/food_service.json";
import { montarPromptSistema } from "@/lib/assessment/agente/prompt";
import { NAO_SE_APLICA, calcularSelf, nivel } from "@/lib/assessment/motor";
import { pessoasPassamDoTotal } from "@/lib/assessment/questionario";
import { montarQuestionario, normalizarRascunho } from "@/lib/assessment/self";
import type { Modelo, Pacote, Respostas } from "@/lib/assessment/tipos";
import respostasPiloto from "../fixtures/assessment/respostas_piloto_self.json";

/**
 * Falhas achadas no teste real do Self (análise de 13/11/2026), corrigidas no
 * motor 0.5.0. Todos os dados aqui são fictícios (Rede Piloto Alfa).
 */
const M = modelo as unknown as Modelo;
const P = pacote as unknown as Pacote;
const base = respostasPiloto as unknown as Respostas;
const q = montarQuestionario();

describe("fontes que não se aplicam ao negócio", () => {
  it("saem da cobertura em vez de contar como lacuna", () => {
    const semDelivery = { ...base, dados_D: { ...base.dados_D, F10: "não tem" } };
    const naoSeAplica = { ...base, dados_D: { ...base.dados_D, F10: NAO_SE_APLICA } };
    const a = calcularSelf(semDelivery, P, M);
    const b = calcularSelf(naoSeAplica, P, M);
    expect(b.score.cobertura_fontes).toBeGreaterThan(a.score.cobertura_fontes);
    expect(b.score.dimensoes.dados).toBeGreaterThan(a.score.dimensoes.dados);
    const f10 = b.mapa_de_dados.find((m) => m.fonte === "F10");
    expect(f10?.situacao).toBe(NAO_SE_APLICA);
    expect(f10?.como_criar).toBeUndefined();
  });

  it("com todas as fontes fora, a cobertura é zero (sem divisão por zero)", () => {
    const todas = Object.fromEntries(P.pergunta_dados_D.itens.map((f) => [f, NAO_SE_APLICA]));
    expect(calcularSelf({ ...base, dados_D: todas }, P, M).score.cobertura_fontes).toBe(0);
  });

  it("é uma opção aceita no formulário e no agente", () => {
    expect(q.opcoes.cobertura).toContain(NAO_SE_APLICA);
    const n = normalizarRascunho({ dados_D: { F10: NAO_SE_APLICA } }, "food_service");
    expect(n.ok).toBe(true);
  });
});

describe("alertas do resultado", () => {
  it("avisa quando a empresa usa IA sem política de IA e dados", () => {
    const r = calcularSelf({ ...base, q9: ["pilotos"], q10: "não" }, P, M);
    expect(r.alertas?.map((a) => a.codigo)).toContain("ia_sem_politica");
    const comPolitica = calcularSelf({ ...base, q9: ["pilotos"], q10: "formal" }, P, M);
    expect(comPolitica.alertas?.map((a) => a.codigo)).not.toContain("ia_sem_politica");
  });

  it("não muda score nem retorno", () => {
    const r1 = calcularSelf({ ...base, q9: ["pilotos"], q10: "não" }, P, M);
    expect(r1.score.valor).toBeGreaterThan(0);
    expect(r1.alertas?.every((a) => a.texto.length > 20)).toBe(true);
  });
});

describe("pessoas das áreas contra o total da empresa", () => {
  const exagero: Respostas = { ...base, q3: "101 a 500", pessoas_q6: { "06_operacoes": "151 a 500", "08_atendimento": "51 a 150" } };

  it("limita o cenário base ao total e avisa; o conservador não muda", () => {
    const r = calcularSelf(exagero, P, M);
    const fteBase = r.retorno.base.pessoas.reduce((s, p) => s + p.fte, 0);
    expect(fteBase).toBeCloseTo(300.5, 6);
    expect(r.retorno.conservador.ajuste_pessoas).toBe(1);
    expect(r.alertas?.map((a) => a.codigo)).toContain("pessoas_acima_do_total");
  });

  it("a tela e o agente usam a mesma regra do motor", () => {
    expect(pessoasPassamDoTotal(q, exagero)).toBe(true);
    expect(pessoasPassamDoTotal(q, { q3: "501 a 2.000", pessoas_q6: exagero.pessoas_q6 })).toBe(false);
  });
});

describe("exemplos do top 3", () => {
  it("não sugere criar uma fonte que a empresa já tem", () => {
    const r = calcularSelf({ ...base, dados_D: { ...base.dados_D, F02: "tem" } }, P, M);
    expect(r.top3.map((t) => t.exemplo)).not.toContain("Medição de tempo de mesa por câmera");
  });

  it("Atendimento tem exemplo próprio", () => {
    const r = calcularSelf({ ...base, pessoas_q6: { "08_atendimento": "21 a 50" } }, P, M);
    const atendimento = r.top3.find((t) => t.origem === "08_atendimento");
    expect(atendimento?.exemplo).toMatch(/atendimento remoto/);
  });
});

describe("segmento de eventos", () => {
  it("entra só pela receita (CMV) e não roda o giro de mesas", () => {
    const r = calcularSelf({ ...base, unidades: [{ segmento: "eventos", quantidade: 2, participacao_receita: 100 }] }, P, M);
    const [cmv, giro] = r.retorno.conservador.alavancas;
    expect(cmv.valor).toBeGreaterThan(0);
    expect(giro.valor).toBe(0);
  });
});

describe("margem e objetivos no relatório", () => {
  it("calcula o retorno em % do lucro pela margem informada", () => {
    const r = calcularSelf({ ...base, q4: "5 a 10%" }, P, M);
    const c = r.retorno.conservador;
    expect(c.pct_lucro).toBeCloseTo((c.P / (c.receita_usada * 0.075)) * 100, 9);
    expect(r.contexto?.margem).toBe("5 a 10%");
  });

  it("sem margem positiva não há % do lucro", () => {
    expect(calcularSelf({ ...base, q4: "negativa" }, P, M).retorno.conservador.pct_lucro).toBeNull();
    expect(calcularSelf({ ...base, q4: "prefiro não dizer" }, P, M).retorno.conservador.pct_lucro).toBeNull();
  });

  it("devolve os objetivos declarados", () => {
    expect(calcularSelf({ ...base, q12: ["reduzir custo", "crescer sem contratar"] }, P, M).contexto?.objetivos).toEqual([
      "reduzir custo",
      "crescer sem contratar",
    ]);
  });
});

describe("nível e score mostrado", () => {
  it("49,8% é Exploratório, e a tela não pode arredondar para 50%", () => {
    expect(nivel(0.498, M.niveis)).toBe("Exploratório");
    expect(Math.floor(0.498 * 100 + 1e-9)).toBe(49);
    expect(Math.floor(0.5 * 100 + 1e-9)).toBe(50);
  });
});

describe("prompt do agente", () => {
  it("leva o escopo das áreas e a regra dos garçons", () => {
    const p = montarPromptSistema(q);
    expect(p).toContain("Garçons, caixa e recepção presencial ficam em Operações");
    expect(p).toContain("não se aplica");
    expect(p).toContain("eventos");
  });
});
