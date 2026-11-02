import { describe, expect, it } from "vitest";
import { resumoAuditoria } from "@/lib/admin/auditoria";
import {
  cnpjValido,
  conviteIdSchema,
  conviteSchema,
  direitoSchema,
  empresaSchema,
  exclusaoSchema,
  lerFiltroUsuarios,
  lerPagina,
  mensagemErroBanco,
  papelSchema,
  staffSchema,
  statusSchema,
  vinculoSchema,
} from "@/lib/validation/admin";

const ID = "10000000-0000-4000-8000-000000000001";

describe("cnpjValido", () => {
  it("aceita CNPJ com dígitos corretos", () => {
    expect(cnpjValido("11222333000181")).toBe(true);
  });
  it("recusa dígito verificador errado, repetidos e tamanho errado", () => {
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(cnpjValido("1122233300018")).toBe(false);
    expect(cnpjValido("1122233300018a")).toBe(false);
  });
});

describe("empresaSchema", () => {
  it("limpa a máscara do CNPJ e converte assentos", () => {
    const r = empresaSchema.parse({ nome: "  Empresa X ", cnpj: "11.222.333/0001-81", assentos: "10" });
    expect(r).toEqual({ nome: "Empresa X", cnpj: "11222333000181", assentos: 10 });
  });
  it("CNPJ vazio vira nulo", () => {
    expect(empresaSchema.parse({ nome: "Empresa X", cnpj: "", assentos: "1" }).cnpj).toBeNull();
  });
  it("recusa CNPJ inválido e assentos fora do limite", () => {
    expect(empresaSchema.safeParse({ nome: "Empresa X", cnpj: "11.222.333/0001-82", assentos: "1" }).success).toBe(false);
    expect(empresaSchema.safeParse({ nome: "Empresa X", assentos: "0" }).success).toBe(false);
    expect(empresaSchema.safeParse({ nome: "Empresa X", assentos: "10001" }).success).toBe(false);
    expect(empresaSchema.safeParse({ nome: "Empresa X", assentos: "2.5" }).success).toBe(false);
  });
});

describe("travas de entrada do backoffice", () => {
  it("papel global: super_admin e papéis de empresa não passam", () => {
    expect(papelSchema.safeParse({ userId: ID, papel: "equipe_iron" }).success).toBe(true);
    expect(papelSchema.safeParse({ userId: ID, papel: "super_admin" }).success).toBe(false);
    expect(papelSchema.safeParse({ userId: ID, papel: "master_b2b" }).success).toBe(false);
  });
  it("vínculo de empresa: só master/membro, e-mail normalizado", () => {
    const r = vinculoSchema.parse({ orgId: ID, email: " Ana@Empresa.com ", papel: "membro_b2b" });
    expect(r.email).toBe("ana@empresa.com");
    expect(vinculoSchema.safeParse({ orgId: ID, email: "a@b.com", papel: "equipe_iron" }).success).toBe(false);
  });
  it("ids precisam ser UUID", () => {
    expect(statusSchema.safeParse({ userId: "1 or 1=1", status: "ativo" }).success).toBe(false);
    expect(statusSchema.safeParse({ userId: ID, status: "admin" }).success).toBe(false);
  });
  it("atribuir staff aceita só 1 ou 0", () => {
    expect(staffSchema.parse({ orgId: ID, userId: ID, atribuir: "1" }).atribuir).toBe(true);
    expect(staffSchema.parse({ orgId: ID, userId: ID, atribuir: "0" }).atribuir).toBe(false);
    expect(staffSchema.safeParse({ orgId: ID, userId: ID, atribuir: "true" }).success).toBe(false);
  });
});

describe("convites", () => {
  it("normaliza o e-mail e exige empresa válida", () => {
    expect(conviteSchema.parse({ orgId: ID, email: " Ana@Empresa.COM " }).email).toBe("ana@empresa.com");
    expect(conviteSchema.safeParse({ orgId: "x", email: "ana@empresa.com" }).success).toBe(false);
    expect(conviteSchema.safeParse({ orgId: ID, email: "ana" }).success).toBe(false);
  });
  it("id do convite precisa ser UUID", () => {
    expect(conviteIdSchema.safeParse({ conviteId: "1; drop table convites" }).success).toBe(false);
    expect(conviteIdSchema.safeParse({ conviteId: ID }).success).toBe(true);
  });
});

describe("LGPD", () => {
  it("pedido de exclusão só aceita UUID", () => {
    expect(exclusaoSchema.safeParse({ solicitacaoId: ID }).success).toBe(true);
    expect(exclusaoSchema.safeParse({ solicitacaoId: "*" }).success).toBe(false);
  });
});

describe("filtros da URL", () => {
  it("padrão é pendente, página 1", () => {
    expect(lerFiltroUsuarios({})).toEqual({ status: "pendente", busca: "", pagina: 1 });
  });
  it("todos remove o filtro; valor estranho volta ao padrão", () => {
    expect(lerFiltroUsuarios({ status: "todos" }).status).toBeNull();
    expect(lerFiltroUsuarios({ status: "'; drop" }).status).toBe("pendente");
    expect(lerFiltroUsuarios({ status: ["ativo", "suspenso"] }).status).toBe("ativo");
  });
  it("busca é cortada em 100 caracteres e página inválida vira 1", () => {
    expect(lerFiltroUsuarios({ q: "x".repeat(300) }).busca).toHaveLength(100);
    expect(lerPagina("-3")).toBe(1);
    expect(lerPagina("abc")).toBe(1);
    expect(lerPagina("99999")).toBe(1);
    expect(lerPagina("4")).toBe(4);
  });
});

describe("mensagemErroBanco", () => {
  it("mostra as mensagens das nossas funções", () => {
    expect(mensagemErroBanco({ code: "42501", message: "não é permitido alterar o próprio status" })).toBe(
      "Não é permitido alterar o próprio status.",
    );
    expect(mensagemErroBanco({ code: "23514", message: "empresa sem assentos disponíveis (3 de 3)" })).toBe(
      "Empresa sem assentos disponíveis (3 de 3).",
    );
  });
  it("esconde detalhe de schema e erros desconhecidos", () => {
    const m = mensagemErroBanco({ code: "23514", message: 'new row for relation "organizations" violates check constraint' });
    expect(m).not.toMatch(/organizations|constraint/);
    expect(mensagemErroBanco({ code: "XX000", message: "internal" })).toBe("Não foi possível concluir agora.");
    expect(mensagemErroBanco({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      "Já existe um registro com esses dados.",
    );
    expect(mensagemErroBanco(null)).toBe("Não foi possível concluir agora.");
  });
});

describe("resumoAuditoria", () => {
  it("descreve mudanças conhecidas sem JSON bruto", () => {
    expect(
      resumoAuditoria({ acao: "update", tabela: "profiles", dados: { antes: { status: "pendente" }, depois: { status: "ativo" } } }),
    ).toBe("Status: Pendente → Ativo");
    expect(resumoAuditoria({ acao: "insert", tabela: "user_roles", dados: { depois: { role: "equipe_iron" } } })).toBe(
      "Papel concedido: Equipe IRON",
    );
    expect(resumoAuditoria({ acao: "delete", tabela: "memberships", dados: { antes: { role: "membro_b2b" } } })).toBe(
      "Saiu da empresa (Membro B2B)",
    );
    expect(
      resumoAuditoria({ acao: "update", tabela: "organizations", dados: { antes: { assentos: 3 }, depois: { assentos: 5 } } }),
    ).toBe("Assentos: 3 → 5");
  });
  it("tolera dados nulos", () => {
    expect(resumoAuditoria({ acao: "insert", tabela: "staff_assignments", dados: null })).toBe("Atribuído a uma empresa");
  });
});

describe("liberação de produtos", () => {
  it("aceita só produtos conhecidos", () => {
    expect(direitoSchema.safeParse({ userId: ID, produto: "self_assessment" }).success).toBe(true);
    expect(direitoSchema.safeParse({ userId: ID, produto: "deep_dive" }).success).toBe(false);
    expect(direitoSchema.safeParse({ userId: "x", produto: "self_assessment" }).success).toBe(false);
  });
  it("resume liberação, revogação e etapas do assessment sem expor respostas", () => {
    expect(resumoAuditoria({ acao: "insert", tabela: "direitos", dados: { depois: { produto: "self_assessment" } } })).toBe(
      "Acesso liberado: Self assessment",
    );
    expect(
      resumoAuditoria({
        acao: "update",
        tabela: "direitos",
        dados: { antes: { produto: "self_assessment", revogado_em: null }, depois: { produto: "self_assessment", revogado_em: "2026-11-02" } },
      }),
    ).toBe("Acesso revogado: Self assessment");
    expect(resumoAuditoria({ acao: "assessment_concluido", tabela: "assessments", dados: null })).toBe("Self assessment concluído");
  });
});
