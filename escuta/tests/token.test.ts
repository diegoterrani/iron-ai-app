import { describe, expect, it } from "vitest";
import { VALIDADE_MAXIMA_S, assinarToken, conferirToken } from "../src/token";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const SESSAO = "0b6f1a2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const SUB = "11111111-2222-4333-8444-555555555555";
const AGORA = 1_800_000_000_000;
const exp = (segundos: number) => Math.floor(AGORA / 1000) + segundos;

describe("token da escuta", () => {
  it("aceita token válido e devolve o payload", async () => {
    const token = await assinarToken({ sessao: SESSAO, sub: SUB, exp: exp(300) }, SEGREDO);
    expect(await conferirToken(token, SEGREDO, AGORA)).toEqual({ ok: true, payload: { sessao: SESSAO, sub: SUB, exp: exp(300) } });
  });

  it("recusa assinatura feita com outro segredo", async () => {
    const token = await assinarToken({ sessao: SESSAO, sub: SUB, exp: exp(300) }, "outro-segredo-tambem-bem-comprido-123456");
    expect(await conferirToken(token, SEGREDO, AGORA)).toEqual({ ok: false, motivo: "assinatura" });
  });

  it("recusa payload trocado mantendo a assinatura (outra reunião)", async () => {
    const token = await assinarToken({ sessao: SESSAO, sub: SUB, exp: exp(300) }, SEGREDO);
    const outro = await assinarToken({ sessao: "99999999-3c4d-4e5f-8a9b-0c1d2e3f4a5b", sub: SUB, exp: exp(300) }, "x".repeat(40));
    const forjado = `${outro.split(".")[0]}.${token.split(".")[1]}`;
    expect(await conferirToken(forjado, SEGREDO, AGORA)).toEqual({ ok: false, motivo: "assinatura" });
  });

  it("recusa token vencido e token com validade longa demais", async () => {
    const vencido = await assinarToken({ sessao: SESSAO, sub: SUB, exp: exp(-1) }, SEGREDO);
    expect(await conferirToken(vencido, SEGREDO, AGORA)).toEqual({ ok: false, motivo: "expirado" });
    const longo = await assinarToken({ sessao: SESSAO, sub: SUB, exp: exp(VALIDADE_MAXIMA_S + 60) }, SEGREDO);
    expect(await conferirToken(longo, SEGREDO, AGORA)).toEqual({ ok: false, motivo: "expirado" });
  });

  it("recusa formato inválido", async () => {
    for (const ruim of ["", "abc", "a.b.c", "!!.??", `${"a".repeat(2000)}.b`]) {
      expect(await conferirToken(ruim, SEGREDO, AGORA)).toEqual({ ok: false, motivo: "formato" });
    }
  });

  it("recusa payload assinado que não tem sessão em formato de id", async () => {
    const token = await assinarToken({ sessao: "../../outra", sub: SUB, exp: exp(300) }, SEGREDO);
    expect(await conferirToken(token, SEGREDO, AGORA)).toEqual({ ok: false, motivo: "formato" });
  });
});
