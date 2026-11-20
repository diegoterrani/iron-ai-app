import { describe, expect, it } from "vitest";
import { Segmentador } from "../src/segmentador";

const opcoes = { pausaMs: 6000, minCaracteres: 40, maxCaracteres: 300 };

describe("segmentador de transcrição", () => {
  it("não fecha bloco antes da pausa nem com pouco conteúdo", () => {
    const s = new Segmentador(opcoes);
    s.adicionar({ canal: "microfone", texto: "Quantos funcionários trabalham no salão hoje?" }, 0);
    expect(s.verificar(5999)).toBeNull();
    const curto = new Segmentador(opcoes);
    curto.adicionar({ canal: "microfone", texto: "Certo." }, 0);
    expect(curto.verificar(60_000)).toBeNull();
  });

  it("fecha por pausa, juntando falas do mesmo canal e separando canais", () => {
    const s = new Segmentador(opcoes);
    s.adicionar({ canal: "microfone", texto: "Quantos funcionários trabalham" }, 0);
    s.adicionar({ canal: "microfone", texto: "no salão hoje?" }, 1000);
    s.adicionar({ canal: "aba", texto: "São doze no salão e oito na cozinha." }, 3000);
    expect(s.verificar(8999)).toBeNull();
    expect(s.verificar(9000)).toEqual({
      numero: 1,
      motivo: "pausa",
      texto: "Sala: Quantos funcionários trabalham no salão hoje?\nRemoto: São doze no salão e oito na cozinha.",
    });
    // Depois de fechar, começa vazio e numera em sequência.
    expect(s.verificar(99_000)).toBeNull();
    s.adicionar({ canal: "aba", texto: "E mais dois entregadores que ficam fixos na loja." }, 100_000);
    expect(s.verificar(106_000)?.numero).toBe(2);
  });

  it("fecha por tamanho sem passar do teto e sem perder texto", () => {
    const s = new Segmentador(opcoes);
    const palavras = Array.from({ length: 200 }, (_, i) => `palavra${i}`);
    const blocos = s.adicionar({ canal: "aba", texto: palavras.join(" ") }, 0);
    const resto = s.encerrar();
    const todos = [...blocos, ...(resto ? [resto] : [])];
    expect(todos.length).toBeGreaterThan(1);
    for (const b of todos) expect(b.texto.length).toBeLessThanOrEqual(opcoes.maxCaracteres);
    const reconstruido = todos.map((b) => b.texto.replace(/^Remoto: /, "")).join(" ");
    expect(reconstruido).toBe(palavras.join(" "));
  });

  it("corta palavra maior que o teto em vez de travar", () => {
    const s = new Segmentador(opcoes);
    const blocos = s.adicionar({ canal: "microfone", texto: "x".repeat(1000) }, 0);
    const resto = s.encerrar();
    const total = [...blocos, ...(resto ? [resto] : [])].map((b) => b.texto.replace(/^Sala: /, "")).join("");
    expect(total).toBe("x".repeat(1000));
  });

  it("ignora fala vazia e normaliza espaços", () => {
    const s = new Segmentador(opcoes);
    expect(s.adicionar({ canal: "microfone", texto: "   \n " }, 0)).toEqual([]);
    expect(s.encerrar()).toBeNull();
    s.adicionar({ canal: "microfone", texto: "  dois   espaços\ne quebra  " }, 0);
    expect(s.encerrar()).toEqual({ numero: 1, motivo: "encerramento", texto: "Sala: dois espaços e quebra" });
  });

  it("recusa opções incoerentes", () => {
    expect(() => new Segmentador({ pausaMs: 0, minCaracteres: 40, maxCaracteres: 300 })).toThrow();
    expect(() => new Segmentador({ pausaMs: 1000, minCaracteres: 300, maxCaracteres: 300 })).toThrow();
  });
});
