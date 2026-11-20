import { describe, expect, it } from "vitest";
import roteiroJson from "@/lib/assessment/dados/food_service_deep.json";
import {
  AREAS,
  carregarRoteiro,
  estadoGatilho,
  gatilhoAtivo,
  roteiroDeep,
  RoteiroInvalido,
  situacaoArea,
  validarValor,
  type PerguntaDeep,
  type RespostaVigente,
} from "@/lib/assessment/deep/roteiro";

const p = (id: string): PerguntaDeep => {
  const q = roteiroDeep.porId.get(id);
  if (!q) throw new Error(`pergunta ${id} não existe`);
  return q;
};
const clone = () => structuredClone(roteiroJson) as unknown as { perguntas: Record<string, unknown>[] } & Record<string, unknown>;
const r = (valor: unknown, nao_se_aplica = false): RespostaVigente => ({ valor, nao_se_aplica });

describe("roteiro do Deep: pacote", () => {
  it("carrega o pacote atual com a versão que o banco aceita", () => {
    expect(roteiroDeep.pacoteVersao).toBe("food_service@0.3");
    expect(roteiroDeep.pacoteVersao).toMatch(/^[a-z_]{2,40}@[0-9]{1,3}\.[0-9]{1,3}$/);
  });

  it("tem perguntas de núcleo em todas as áreas e ids no formato do banco", () => {
    for (const area of AREAS) {
      expect(roteiroDeep.perguntas.some((q) => q.area === area && q.nucleo)).toBe(true);
    }
    for (const q of roteiroDeep.perguntas) expect(q.id).toMatch(/^[a-z0-9][a-z0-9_.-]{0,79}$/);
  });

  it("junta F01 a F20 e cobre todos os pilares do doc", () => {
    for (let i = 1; i <= 20; i++) expect(roteiroDeep.fontes[`F${String(i).padStart(2, "0")}`]).toBeDefined();
    expect(Object.keys(roteiroDeep.pilares).sort()).toEqual(
      ["cozinha", "diretoria", "eventos", "financeiro", "medicao", "pessoas", "salao", "supply", "toque_humano"],
    );
    for (const pilar of Object.keys(roteiroDeep.pilares)) {
      expect(roteiroDeep.perguntas.some((q) => q.pilar === pilar)).toBe(true);
    }
  });

  it("gera os critérios de gate das áreas A, B e C", () => {
    expect(roteiroDeep.criteriosGate).toContain("gate.a.linha_base");
    expect(roteiroDeep.criteriosGate).toContain("gate.c.inegociaveis");
    expect(roteiroDeep.criteriosGate).toHaveLength(15);
    for (const c of roteiroDeep.criteriosGate) expect(c).toMatch(/^[a-z0-9][a-z0-9_.-]{0,79}$/);
  });

  it.each([
    ["id repetido", (j: ReturnType<typeof clone>) => j.perguntas.push({ ...j.perguntas[0] }), "repetida"],
    ["pilar de outra área", (j: ReturnType<typeof clone>) => (j.perguntas[0].pilar = "cozinha"), "é da área A"],
    ["id sem prefixo da área", (j: ReturnType<typeof clone>) => (j.perguntas[0].id = "x.di1"), "começar pela área"],
    ["fonte fora do catálogo", (j: ReturnType<typeof clone>) => (j.perguntas[0].fontes = ["F99"]), "F99"],
    ["opção sem lista", (j: ReturnType<typeof clone>) => (j.perguntas[0].tipo = "opcao"), "opções"],
    ["gatilho para frente", (j: ReturnType<typeof clone>) => (j.perguntas[0].gatilho = { pergunta: "c.fi1", igual: "manual" }), "não vem antes"],
    ["gatilho com opção inexistente", (j: ReturnType<typeof clone>) => {
      const q = j.perguntas.find((x) => x.id === "b.ev1")!;
      q.gatilho = { pergunta: "t.di3", contem: "hotelaria" };
    }, "não tem"],
    ["gatilho com valor de tipo errado", (j: ReturnType<typeof clone>) => {
      const q = j.perguntas.find((x) => x.id === "b.ev6")!;
      q.gatilho = { pergunta: "b.ev5", igual: "sim" };
    }, "não aceita"],
    ["fonte nova repetindo o catálogo", (j: ReturnType<typeof clone>) => {
      (j.fontes_novas as Record<string, unknown>).F01 = { nome: "x", se_faltar: "y" };
    }, "já existe"],
  ])("recusa pacote com %s", (_nome, estragar, mensagem) => {
    const j = clone();
    estragar(j);
    expect(() => carregarRoteiro(j)).toThrow(RoteiroInvalido);
    expect(() => carregarRoteiro(j)).toThrow(mensagem);
  });

  it("recusa campo desconhecido na pergunta (esquema estrito)", () => {
    const j = clone();
    j.perguntas[0].peso = 3;
    expect(() => carregarRoteiro(j)).toThrow();
  });
});

describe("roteiro do Deep: validação das respostas", () => {
  it("texto: apara e recusa vazio ou longo demais", () => {
    expect(validarValor(p("t.di1"), "  CMV, folha e juros ")).toEqual({ ok: true, valor: "CMV, folha e juros" });
    expect(validarValor(p("t.di1"), "   ").ok).toBe(false);
    expect(validarValor(p("t.di1"), "x".repeat(2001)).ok).toBe(false);
    expect(validarValor(p("t.di1"), 42).ok).toBe(false);
  });

  it("número: faixa, inteiro e tipo", () => {
    expect(validarValor(p("t.me2"), 12)).toEqual({ ok: true, valor: 12 });
    expect(validarValor(p("t.me2"), 12.5).ok).toBe(false);
    expect(validarValor(p("t.me2"), 91).ok).toBe(false);
    expect(validarValor(p("t.me2"), -1).ok).toBe(false);
    expect(validarValor(p("t.me2"), "12").ok).toBe(false);
    expect(validarValor(p("t.me2"), Number.NaN).ok).toBe(false);
  });

  it("percentual: 0 a 100, aceita decimal", () => {
    expect(validarValor(p("a.cz4"), 6.5)).toEqual({ ok: true, valor: 6.5 });
    expect(validarValor(p("a.cz4"), 101).ok).toBe(false);
    expect(validarValor(p("a.cz4"), -0.1).ok).toBe(false);
  });

  it("moeda: não aceita negativo", () => {
    expect(validarValor(p("c.fi2"), 180000).ok).toBe(true);
    expect(validarValor(p("c.fi2"), -5).ok).toBe(false);
  });

  it("opção, múltipla e sim/não", () => {
    expect(validarValor(p("c.fi1"), "manual").ok).toBe(true);
    expect(validarValor(p("c.fi1"), "Manual").ok).toBe(false);
    expect(validarValor(p("t.di3"), ["eventos", "restaurantes", "eventos"])).toEqual({
      ok: true,
      valor: ["restaurantes", "eventos"],
    });
    expect(validarValor(p("t.di3"), []).ok).toBe(false);
    expect(validarValor(p("t.di3"), ["hotelaria"]).ok).toBe(false);
    expect(validarValor(p("t.me1"), true).ok).toBe(true);
    expect(validarValor(p("t.me1"), "sim").ok).toBe(false);
  });

  it("todo erro diz qual pergunta falhou", () => {
    const v = validarValor(p("t.me2"), 500);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.erro).toMatch(/^t\.me2: /);
  });
});

describe("roteiro do Deep: gatilhos e fila da área", () => {
  it("gatilho por opção marcada, igualdade e diferença", () => {
    const escopo = { "t.di3": r(["restaurantes", "institucional"]) };
    expect(gatilhoAtivo(p("a.cz7"), escopo)).toBe(true);
    expect(gatilhoAtivo(p("b.ev1"), escopo)).toBe(false);
    expect(gatilhoAtivo(p("a.cz4"), { "a.cz3": r(true) })).toBe(true);
    expect(gatilhoAtivo(p("a.cz4"), { "a.cz3": r(false) })).toBe(false);
    expect(gatilhoAtivo(p("b.sa2"), { "b.sa1": r("whatsapp") })).toBe(true);
    expect(gatilhoAtivo(p("b.sa2"), { "b.sa1": r("nao_trabalha_com_reserva") })).toBe(false);
    expect(gatilhoAtivo(p("b.sa2"), { "b.sa1": r(null, true) })).toBe(false);
    expect(gatilhoAtivo(p("t.di1"), {})).toBe(true);
  });

  it("fila começa pelo núcleo e tira o que já foi respondido", () => {
    const s = situacaoArea(roteiroDeep, "transversal", { "t.di1": r("CMV") });
    expect(s.fila.map((q) => q.id)).not.toContain("t.di1");
    const primeiroAprofundamento = s.fila.findIndex((q) => !q.nucleo);
    expect(s.fila.slice(primeiroAprofundamento).every((q) => !q.nucleo)).toBe(true);
    expect(s.nucleoRespondidas).toBe(1);
  });

  it("gatilho em cadeia: sem eventos no escopo, b.ev6 sai junto com b.ev5", () => {
    expect(estadoGatilho(roteiroDeep, p("b.ev6"), { "t.di3": r(["restaurantes"]) })).toBe("inativo");
    expect(estadoGatilho(roteiroDeep, p("b.ev6"), {})).toBe("aguardando");
    expect(estadoGatilho(roteiroDeep, p("b.ev6"), { "t.di3": r(["eventos"]) })).toBe("aguardando");
    expect(estadoGatilho(roteiroDeep, p("b.ev6"), { "t.di3": r(["eventos"]), "b.ev5": r(false) })).toBe("inativo");
    expect(estadoGatilho(roteiroDeep, p("b.ev6"), { "t.di3": r(["eventos"]), "b.ev5": r(true) })).toBe("ativo");
  });

  it("sem o escopo, perguntas de eventos esperam o gatilho", () => {
    const s = situacaoArea(roteiroDeep, "B", {});
    expect(s.aguardandoGatilho).toEqual(expect.arrayContaining(["b.ev1", "b.ev4", "b.sa1"]));
    expect(s.fila.map((q) => q.id)).toEqual(["b.sa4", "b.sa5"]);
  });

  it("escopo sem eventos tira eventos da conta; com eventos, entram", () => {
    const sem = situacaoArea(roteiroDeep, "B", { "t.di3": r(["restaurantes"]) });
    expect(sem.fila.some((q) => q.pilar === "eventos")).toBe(false);
    expect(sem.aguardandoGatilho).toEqual(["b.sa2"]);

    const com = situacaoArea(roteiroDeep, "B", { "t.di3": r(["eventos"]), "b.ev5": r(true) });
    expect(com.fila.map((q) => q.id)).toEqual(expect.arrayContaining(["b.ev1", "b.ev6"]));
    expect(com.fila.some((q) => q.pilar === "salao" && q.id !== "b.sa4" && q.id !== "b.sa5")).toBe(false);
  });

  it("várias respostas numa fala fecham o núcleo da área de uma vez", () => {
    const respostas: Record<string, RespostaVigente> = { "t.di3": r(["restaurantes", "institucional", "cozinha_central"]) };
    for (const q of roteiroDeep.perguntas.filter((x) => x.area === "A" && x.nucleo)) {
      respostas[q.id] = r(q.tipo === "sim_nao" ? true : "ok");
    }
    const s = situacaoArea(roteiroDeep, "A", respostas);
    expect(s.nucleoRespondidas).toBe(s.nucleoTotal);
    expect(s.fila.every((q) => !q.nucleo)).toBe(true);
    expect(s.aguardandoGatilho).toEqual([]);
  });
});
