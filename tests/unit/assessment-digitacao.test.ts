import { describe, expect, it } from "vitest";
import {
  DURACAO_MAXIMA_MS,
  INTERVALO_DIGITACAO_MS,
  palavrasPorPasso,
  pedacosDeDigitacao,
  textoParcial,
} from "@/lib/assessment/agente/digitacao";

describe("digitação das falas", () => {
  it("os pedaços reconstroem o texto exato, com quebras de linha", () => {
    const texto = "Anotei: 7 restaurantes.\nComo vocês controlam o estoque?\n\n1. Manual\n2. Planilhas";
    expect(pedacosDeDigitacao(texto).join("")).toBe(texto);
  });

  it("revela uma palavra por pedaço", () => {
    const p = pedacosDeDigitacao("Bom dia, tudo bem?");
    expect(p).toHaveLength(4);
    expect(textoParcial(p, 2)).toBe("Bom dia,");
  });

  it("mantém o número da opção junto da primeira palavra", () => {
    const p = pedacosDeDigitacao("Escolha:\n1. Manual ou papel\n2. Planilhas");
    expect(p).toContain("1. Manual ");
    expect(textoParcial(p, 2)).toBe("Escolha:\n1. Manual");
  });

  it("texto vazio não gera pedaços", () => {
    expect(pedacosDeDigitacao("")).toEqual([]);
    expect(textoParcial([], 3)).toBe("");
  });

  it("texto longo avança mais de uma palavra por passo e termina no tempo máximo", () => {
    const passos = Math.floor(DURACAO_MAXIMA_MS / INTERVALO_DIGITACAO_MS);
    expect(palavrasPorPasso(10)).toBe(1);
    expect(palavrasPorPasso(passos * 2 + 1)).toBe(3);
    const total = 500;
    expect(Math.ceil(total / palavrasPorPasso(total)) * INTERVALO_DIGITACAO_MS).toBeLessThanOrEqual(DURACAO_MAXIMA_MS);
  });
});
