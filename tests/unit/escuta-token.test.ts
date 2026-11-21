import { describe, expect, it } from "vitest";
import { conferirToken } from "../../escuta/src/token";
import { assinarTokenEscuta, sessaoDaEscuta, tokenDaEscuta, VALIDADE_TOKEN_S } from "@/lib/escuta/token";

/**
 * O app emite o token e o Worker confere: o teste usa o código do próprio
 * Worker (escuta/src/token.ts) para os dois lados nunca divergirem.
 */
const segredo = "s".repeat(40);
const assessment = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const user = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

describe("token da escuta", () => {
  it("o Worker aceita o token emitido pelo app", async () => {
    const agora = Date.now();
    const exp = Math.floor(agora / 1000) + VALIDADE_TOKEN_S;
    const token = await assinarTokenEscuta({ sessao: sessaoDaEscuta(assessment, user), sub: user, exp }, segredo);
    const r = await conferirToken(token, segredo, agora);
    expect(r).toEqual({ ok: true, payload: { sessao: sessaoDaEscuta(assessment, user), sub: user, exp } });
  });

  it("segredo diferente ou validade acima do teto do Worker são recusados", async () => {
    const agora = Date.now();
    const exp = Math.floor(agora / 1000) + VALIDADE_TOKEN_S;
    const token = await assinarTokenEscuta({ sessao: sessaoDaEscuta(assessment, user), sub: user, exp }, segredo);
    expect((await conferirToken(token, "x".repeat(40), agora)).ok).toBe(false);
    const longo = await assinarTokenEscuta({ sessao: sessaoDaEscuta(assessment, user), sub: user, exp: exp + 3600 }, segredo);
    expect(await conferirToken(longo, segredo, agora)).toEqual({ ok: false, motivo: "expirado" });
  });

  it("a reunião no Worker é fixa por pessoa e assessment, em formato UUID, sem expor os ids", () => {
    const s = sessaoDaEscuta(assessment, user);
    expect(s).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sessaoDaEscuta(assessment, user)).toBe(s);
    expect(sessaoDaEscuta(assessment, "1a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d")).not.toBe(s);
    expect(s).not.toContain(assessment.slice(0, 8));
  });

  it("sem o segredo configurado, não emite token", async () => {
    const antes = process.env.ESCUTA_TOKEN_SECRET;
    delete process.env.ESCUTA_TOKEN_SECRET;
    await expect(tokenDaEscuta(assessment, user)).rejects.toThrow();
    process.env.ESCUTA_TOKEN_SECRET = "curto";
    await expect(tokenDaEscuta(assessment, user)).rejects.toThrow();
    process.env.ESCUTA_TOKEN_SECRET = segredo;
    const t = await tokenDaEscuta(assessment, user);
    expect((await conferirToken(t.token, segredo, Date.now())).ok).toBe(true);
    if (antes === undefined) delete process.env.ESCUTA_TOKEN_SECRET;
    else process.env.ESCUTA_TOKEN_SECRET = antes;
  });
});
