import { describe, expect, it } from "vitest";
import { isGuestOnlyPath, isPublicPath } from "@/lib/auth/routes";
import { maskEmail } from "@/lib/log";

describe("rotas públicas (lista de permissão)", () => {
  it.each(["/", "/entrar", "/cadastro", "/recuperar-senha", "/verifique-email", "/auth/callback", "/auth/confirmar"])(
    "%s é pública",
    (p) => expect(isPublicPath(p)).toBe(true),
  );

  it.each(["/painel", "/admin", "/redefinir-senha", "/aguardando-aprovacao", "/entrar/x", "/authx"])(
    "%s exige login",
    (p) => expect(isPublicPath(p)).toBe(false),
  );

  it("só entrar e cadastro mandam logado ao painel", () => {
    expect(isGuestOnlyPath("/entrar")).toBe(true);
    expect(isGuestOnlyPath("/recuperar-senha")).toBe(false);
  });
});

describe("maskEmail", () => {
  it("esconde o usuário do e-mail", () => {
    expect(maskEmail("diego@iron-ai.io")).toBe("d***@iron-ai.io");
    expect(maskEmail("lixo")).toBe("***");
  });
});

describe("rotas de MFA", () => {
  it("verificar-mfa e conta exigem login", () => {
    expect(isPublicPath("/verificar-mfa")).toBe(false);
    expect(isPublicPath("/conta/seguranca")).toBe(false);
  });
});
