import { describe, expect, it } from "vitest";
import { ARQUIVOS_TESTE, TAMANHO_MINIMO_CODIGO, cabecalhosTeste, codigoConfere, modoTesteLigado } from "../src/teste";

describe("modo de teste", () => {
  it("só liga com código cadastrado e longo", () => {
    expect(modoTesteLigado(undefined)).toBe(false);
    expect(modoTesteLigado("")).toBe(false);
    expect(modoTesteLigado("a".repeat(TAMANHO_MINIMO_CODIGO - 1))).toBe(false);
    expect(modoTesteLigado("a".repeat(TAMANHO_MINIMO_CODIGO))).toBe(true);
  });

  it("confere o código exato e recusa qualquer variação", async () => {
    const certo = "codigo-de-teste-bem-longo-123";
    expect(await codigoConfere(certo, certo)).toBe(true);
    for (const errado of ["", certo.slice(0, -1), `${certo} `, certo.toUpperCase(), `${certo}x`]) {
      expect(await codigoConfere(errado, certo)).toBe(false);
    }
  });

  it("CSP da página não tem curinga nem inline e libera só o próprio Worker", () => {
    const csp = cabecalhosTeste("escuta.exemplo.dev")["Content-Security-Policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' wss://escuta.exemplo.dev");
    expect(csp).not.toMatch(/unsafe|\*/);
  });

  it("serve só os quatro arquivos da página", () => {
    expect(Object.keys(ARQUIVOS_TESTE).sort()).toEqual(["/teste/", "/teste/captura-worklet.js", "/teste/teste.css", "/teste/teste.js"]);
  });
});
