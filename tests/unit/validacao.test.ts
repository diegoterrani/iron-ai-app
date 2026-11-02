import { describe, expect, it } from "vitest";
import { cadastroSchema, entrarSchema, fieldErrors, redefinirSchema } from "@/lib/validation/auth";

const valido = {
  nome: "Diego Terrani",
  email: "  Diego@Iron-AI.io ",
  senha: "uma frase longa e boa",
  aceiteTermos: "on",
};

describe("cadastroSchema", () => {
  it("normaliza e-mail e aceita cadastro válido", () => {
    const r = cadastroSchema.parse(valido);
    expect(r.email).toBe("diego@iron-ai.io");
  });

  it("exige senha de 12+ caracteres", () => {
    const r = cadastroSchema.safeParse({ ...valido, senha: "curta123" });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).senha).toMatch(/12 caracteres/);
  });

  it("exige aceite dos termos", () => {
    const { aceiteTermos: _omit, ...semAceite } = valido;
    void _omit;
    const r = cadastroSchema.safeParse(semAceite);
    expect(fieldErrors(r.error!).aceiteTermos).toMatch(/aceitar/);
  });

  it("recusa e-mail inválido e nome vazio", () => {
    const r = cadastroSchema.safeParse({ ...valido, email: "nao-e-email", nome: " " });
    const e = fieldErrors(r.error!);
    expect(e.email).toBeDefined();
    expect(e.nome).toBeDefined();
  });

  it("limita senha a 128 caracteres", () => {
    expect(cadastroSchema.safeParse({ ...valido, senha: "a".repeat(129) }).success).toBe(false);
  });
});

describe("entrarSchema", () => {
  it("não aplica regra de tamanho no login (só no cadastro)", () => {
    expect(entrarSchema.safeParse({ email: "a@b.co", senha: "x" }).success).toBe(true);
  });
});

describe("redefinirSchema", () => {
  it("exige confirmação igual", () => {
    const r = redefinirSchema.safeParse({ senha: "senha nova bem longa", confirmacao: "outra coisa qualquer" });
    expect(fieldErrors(r.error!).confirmacao).toMatch(/não conferem/);
  });
});
