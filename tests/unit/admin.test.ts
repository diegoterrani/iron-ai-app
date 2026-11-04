import { describe, expect, it } from "vitest";
import { resumoAuditoria } from "@/lib/admin/auditoria";
import {
  cnpjValido,
  conviteIdSchema,
  descarteRascunhoSchema,
  conviteSchema,
  direitoEmpresaSchema,
  direitoSchema,
  empresaSchema,
  exclusaoSchema,
  lerFiltroUsuarios,
  lerPagina,
  mensagemErroBanco,
  remocaoAssessmentSchema,
  papelClienteSchema,
  papelSchema,
  staffSchema,
  statusSchema,
  transferenciaAssessmentSchema,
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
    expect(papelSchema.safeParse({ userId: ID, papel: "adm_cliente" }).success).toBe(false);
  });
  it("vínculo de empresa: só ADM/RW/RO-Cliente, e-mail normalizado", () => {
    const r = vinculoSchema.parse({ orgId: ID, email: " Ana@Empresa.com ", papel: "rw_cliente" });
    expect(r.email).toBe("ana@empresa.com");
    expect(vinculoSchema.safeParse({ orgId: ID, email: "a@b.com", papel: "equipe_iron" }).success).toBe(false);
  });
  it("ADM-Cliente só convida ou troca para RW ou RO", () => {
    expect(conviteSchema.parse({ orgId: ID, email: "a@b.com", papel: "ro_cliente" }).papel).toBe("ro_cliente");
    expect(conviteSchema.safeParse({ orgId: ID, email: "a@b.com", papel: "adm_cliente" }).success).toBe(false);
    expect(conviteSchema.safeParse({ orgId: ID, email: "a@b.com" }).success).toBe(false);
    expect(papelClienteSchema.safeParse({ orgId: ID, userId: ID, papel: "rw_cliente" }).success).toBe(true);
    expect(papelClienteSchema.safeParse({ orgId: ID, userId: ID, papel: "adm_cliente" }).success).toBe(false);
    expect(papelClienteSchema.safeParse({ orgId: ID, userId: ID, papel: "super_admin" }).success).toBe(false);
  });
  it("transferência de assessment exige empresa, UUIDs e motivo", () => {
    expect(transferenciaAssessmentSchema.safeParse({ assessmentId: ID, orgId: ID, motivo: "virou empresa" }).success).toBe(true);
    expect(transferenciaAssessmentSchema.safeParse({ assessmentId: ID, motivo: "virou empresa" }).success).toBe(false);
    expect(transferenciaAssessmentSchema.safeParse({ assessmentId: ID, orgId: ID, motivo: "x" }).success).toBe(false);
    expect(transferenciaAssessmentSchema.safeParse({ assessmentId: ID, orgId: "1 or 1=1", motivo: "virou empresa" }).success).toBe(false);
    expect(resumoAuditoria({ acao: "assessment_transferido", tabela: "assessments", dados: { motivo: "virou empresa" } as never })).toBe(
      "Self assessment transferido para a empresa: virou empresa",
    );
  });
  it("direito da empresa exige UUID e produto conhecido", () => {
    expect(direitoEmpresaSchema.safeParse({ orgId: ID, produto: "self_assessment" }).success).toBe(true);
    expect(direitoEmpresaSchema.safeParse({ orgId: ID, produto: "deep_dive" }).success).toBe(false);
    expect(direitoEmpresaSchema.safeParse({ orgId: "x", produto: "self_assessment" }).success).toBe(false);
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
    expect(conviteSchema.parse({ orgId: ID, email: " Ana@Empresa.COM ", papel: "rw_cliente" }).email).toBe("ana@empresa.com");
    expect(conviteSchema.safeParse({ orgId: "x", email: "ana@empresa.com", papel: "rw_cliente" }).success).toBe(false);
    expect(conviteSchema.safeParse({ orgId: ID, email: "ana", papel: "rw_cliente" }).success).toBe(false);
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
    expect(resumoAuditoria({ acao: "delete", tabela: "memberships", dados: { antes: { role: "rw_cliente" } } })).toBe(
      "Saiu da empresa (RW-Cliente)",
    );
    expect(
      resumoAuditoria({ acao: "update", tabela: "memberships", dados: { antes: { role: "rw_cliente" }, depois: { role: "ro_cliente" } } }),
    ).toBe("Papel na empresa: RW-Cliente → RO-Cliente");
    expect(resumoAuditoria({ acao: "assessment_editado", tabela: "assessments", dados: {} })).toBe(
      "Self assessment da empresa editado",
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

describe("remoção de assessments", () => {
  const id = "7d000000-0000-4000-8000-000000000001";

  it("super-admin precisa de motivo de 5 a 300 caracteres", () => {
    expect(remocaoAssessmentSchema.safeParse({ assessmentId: id, motivo: "teste de mesa" }).success).toBe(true);
    expect(remocaoAssessmentSchema.safeParse({ assessmentId: id, motivo: "  ab  " }).success).toBe(false);
    expect(remocaoAssessmentSchema.safeParse({ assessmentId: id, motivo: "x".repeat(301) }).success).toBe(false);
    expect(remocaoAssessmentSchema.safeParse({ assessmentId: "1 or 1=1", motivo: "teste de mesa" }).success).toBe(false);
  });

  it("descarte do rascunho exige a confirmação marcada", () => {
    expect(descarteRascunhoSchema.safeParse({ assessmentId: id, confirmar: "on" }).success).toBe(true);
    expect(descarteRascunhoSchema.safeParse({ assessmentId: id }).success).toBe(false);
  });

  it("auditoria mostra quem removeu e o motivo, sem respostas", () => {
    expect(resumoAuditoria({ acao: "assessment_descartado", tabela: "assessments", dados: null })).toBe(
      "Rascunho do Self assessment descartado",
    );
    expect(
      resumoAuditoria({
        acao: "assessment_removido",
        tabela: "assessments",
        dados: { motivo: "teste de mesa" } as never,
      }),
    ).toBe("Self assessment removido pelo admin: teste de mesa");
  });
});
