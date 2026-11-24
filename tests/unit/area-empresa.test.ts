import { describe, expect, it } from "vitest";
import { resumoAuditoria } from "@/lib/admin/auditoria";
import { isPublicPath } from "@/lib/auth/routes";
import { resumoResultado } from "@/lib/empresa/area";
import {
  exclusaoAssessmentSchema,
  exclusaoCadastroEmpresaSchema,
  exclusaoEmpresaSchema,
  exclusaoUsuarioSchema,
} from "@/lib/validation/admin";

const ID = "3f2b8c1e-9a4d-4c2b-8e1f-2a7d5c9b0e41";

describe("excluir empresa: validação da entrada", () => {
  it("exige nome digitado e motivo de 5 a 300 caracteres", () => {
    expect(exclusaoEmpresaSchema.safeParse({ orgId: ID, confirmacao: "Capim", motivo: "cliente encerrou" }).success).toBe(true);
    expect(exclusaoEmpresaSchema.safeParse({ orgId: ID, confirmacao: "   ", motivo: "cliente encerrou" }).success).toBe(false);
    expect(exclusaoEmpresaSchema.safeParse({ orgId: ID, confirmacao: "Capim", motivo: "abc" }).success).toBe(false);
    expect(exclusaoEmpresaSchema.safeParse({ orgId: ID, confirmacao: "Capim", motivo: "x".repeat(301) }).success).toBe(false);
  });

  it("recusa id que não é UUID", () => {
    expect(exclusaoEmpresaSchema.safeParse({ orgId: "1 or 1=1", confirmacao: "Capim", motivo: "cliente encerrou" }).success).toBe(false);
  });
});

describe("excluir usuário: validação da entrada", () => {
  it("exige e-mail digitado e motivo", () => {
    expect(exclusaoUsuarioSchema.safeParse({ userId: ID, confirmacao: "ana@x.com", motivo: "pedido do cliente" }).success).toBe(true);
    expect(exclusaoUsuarioSchema.safeParse({ userId: ID, confirmacao: "", motivo: "pedido do cliente" }).success).toBe(false);
    expect(exclusaoUsuarioSchema.safeParse({ userId: ID, confirmacao: "ana@x.com" }).success).toBe(false);
  });
});

describe("excluir assessment e cadastro de empresa do Self: validação da entrada", () => {
  it("exige marcar a confirmação", () => {
    expect(exclusaoAssessmentSchema.safeParse({ assessmentId: ID, confirmar: "on" }).success).toBe(true);
    expect(exclusaoAssessmentSchema.safeParse({ assessmentId: ID }).success).toBe(false);
    expect(exclusaoCadastroEmpresaSchema.safeParse({ empresaId: ID, confirmar: "on" }).success).toBe(true);
    expect(exclusaoCadastroEmpresaSchema.safeParse({ empresaId: ID }).success).toBe(false);
  });

  it("recusa id que não é UUID", () => {
    expect(exclusaoAssessmentSchema.safeParse({ assessmentId: "1 or 1=1", confirmar: "on" }).success).toBe(false);
    expect(exclusaoCadastroEmpresaSchema.safeParse({ empresaId: "../x", confirmar: "on" }).success).toBe(false);
  });
});

describe("resumo do resultado do Self na área da empresa", () => {
  it("lê retorno e veredito do motor 0.6.0 em diante", () => {
    expect(resumoResultado({ regua: { retorno_x: 3.2, veredito: "seguir" } })).toEqual({ retorno: 3.2, veredito: "seguir" });
  });

  it("formato antigo ou quebrado não derruba a tela", () => {
    expect(resumoResultado(null)).toBeNull();
    expect(resumoResultado({})).toBeNull();
    expect(resumoResultado({ regua: { retorno_x: "3,2" } })).toBeNull();
  });
});

describe("auditoria das exclusões", () => {
  it("mostra nome e motivo da empresa excluída", () => {
    const linha = { acao: "empresa_excluida", tabela: "organizations", dados: { nome: "Capim", motivo: "fim do piloto" } };
    expect(resumoAuditoria(linha as never)).toBe("Empresa excluída: Capim (fim do piloto)");
  });

  it("mostra o motivo da exclusão autorizada (antes de apagar no login)", () => {
    const linha = { acao: "usuario_exclusao_autorizada", tabela: "profiles", dados: { motivo: "pedido do cliente" } };
    expect(resumoAuditoria(linha as never)).toBe("Exclusão da conta autorizada pelo backoffice: pedido do cliente");
  });

  it("mostra a exclusão de assessment e de cadastro de empresa", () => {
    expect(resumoAuditoria({ acao: "assessment_excluido", tabela: "assessments", dados: {} } as never)).toBe(
      "Self assessment excluído (com resultado e conversas)",
    );
    expect(resumoAuditoria({ acao: "cadastro_empresa_excluido", tabela: "empresas_cadastro", dados: { nome: "Capim" } } as never)).toBe(
      "Cadastro de empresa do Self excluído: Capim",
    );
  });

  it("mostra o motivo da conta excluída", () => {
    const linha = { acao: "usuario_excluido", tabela: "profiles", dados: { motivo: "pedido do cliente" } };
    expect(resumoAuditoria(linha as never)).toBe("Conta excluída pelo backoffice: pedido do cliente");
  });
});

describe("rota da área da empresa", () => {
  it("exige login", () => {
    expect(isPublicPath("/empresas")).toBe(false);
    expect(isPublicPath(`/empresas/${ID}`)).toBe(false);
  });
});
