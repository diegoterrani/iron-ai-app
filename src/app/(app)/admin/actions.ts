"use server";

import { redirect } from "next/navigation";
import { executar } from "@/lib/acao/executar";
import type { AcaoState } from "@/lib/acao/tipos";
import { podeUsarBackoffice } from "@/lib/auth/admin";
import { log } from "@/lib/log";
import { createAdminAuth } from "@/lib/supabase/admin";
import {
  assentosSchema,
  exclusaoSchema,
  desvinculoSchema,
  direitoSchema,
  empresaSchema,
  papelSchema,
  remocaoAssessmentSchema,
  staffSchema,
  statusSchema,
  vinculoSchema,
} from "@/lib/validation/admin";

/**
 * Operações do backoffice: cada uma chama funções admin_* do banco
 * (security definer, auditadas) pelo molde de src/lib/acao/executar.ts.
 */

const ADMIN = { autorizar: podeUsarBackoffice, revalidar: "/admin" };

export async function definirStatus(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.status",
    statusSchema,
    form,
    (rpc, d) => rpc("admin_definir_status", { p_user: d.userId, p_status: d.status }),
    "Status atualizado.",
    ADMIN,
  );
  return estado;
}

export async function concederPapel(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.papel_conceder",
    papelSchema,
    form,
    (rpc, d) => rpc("admin_conceder_papel", { p_user: d.userId, p_role: d.papel }),
    "Papel concedido.",
    ADMIN,
  );
  return estado;
}

export async function revogarPapel(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.papel_revogar",
    papelSchema,
    form,
    (rpc, d) => rpc("admin_revogar_papel", { p_user: d.userId, p_role: d.papel }),
    "Papel revogado.",
    ADMIN,
  );
  return estado;
}

export async function concederDireito(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.direito_conceder",
    direitoSchema,
    form,
    (rpc, d) => rpc("admin_conceder_direito", { p_user: d.userId, p_produto: d.produto }),
    "Acesso liberado.",
    ADMIN,
  );
  return estado;
}

export async function revogarDireito(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.direito_revogar",
    direitoSchema,
    form,
    (rpc, d) => rpc("admin_revogar_direito", { p_user: d.userId, p_produto: d.produto }),
    "Acesso revogado.",
    ADMIN,
  );
  return estado;
}

export async function removerAssessment(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.assessment_remover",
    remocaoAssessmentSchema,
    form,
    (rpc, d) => rpc("admin_remover_assessment", { p_assessment: d.assessmentId, p_motivo: d.motivo }),
    "Assessment removido.",
    ADMIN,
  );
  return estado;
}

export async function criarEmpresa(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado, data } = await executar(
    "admin.empresa_criar",
    empresaSchema,
    form,
    (rpc, d) => rpc("admin_criar_empresa", { p_nome: d.nome, p_cnpj: d.cnpj, p_assentos: d.assentos }),
    "Empresa criada.",
    ADMIN,
  );
  // redirect fora do try: o Next usa exceção para redirecionar.
  if (estado.ok && typeof data === "string") redirect(`/admin/empresas/${data}`);
  return estado;
}

export async function definirAssentos(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.empresa_assentos",
    assentosSchema,
    form,
    (rpc, d) => rpc("admin_definir_assentos", { p_org: d.orgId, p_assentos: d.assentos }),
    "Assentos atualizados.",
    ADMIN,
  );
  return estado;
}

export async function vincularEmpresa(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.empresa_vincular",
    vinculoSchema,
    form,
    async (rpc, d) => {
      const busca = await rpc("admin_buscar_usuario_por_email", { p_email: d.email });
      if (busca.error) return busca;
      if (typeof busca.data !== "string") {
        // Mensagem própria: só o super-admin chega aqui, então não há enumeração.
        return { data: null, error: { code: "P0002", message: "nenhuma conta com esse e-mail; peça para a pessoa se cadastrar antes" } };
      }
      return rpc("admin_vincular_empresa", { p_org: d.orgId, p_user: busca.data, p_role: d.papel });
    },
    "Pessoa vinculada à empresa.",
    ADMIN,
  );
  return estado;
}

export async function desvincularEmpresa(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.empresa_desvincular",
    desvinculoSchema,
    form,
    (rpc, d) => rpc("admin_desvincular_empresa", { p_org: d.orgId, p_user: d.userId }),
    "Vínculo removido.",
    ADMIN,
  );
  return estado;
}

export async function atribuirStaff(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.staff",
    staffSchema,
    form,
    (rpc, d) => rpc("admin_atribuir_staff", { p_user: d.userId, p_org: d.orgId, p_atribuir: d.atribuir }),
    "Atribuição atualizada.",
    ADMIN,
  );
  return estado;
}

/**
 * LGPD: conclui um pedido de exclusão feito pelo próprio titular.
 * 1. o banco autoriza (pedido pendente, não é super-admin nem a própria conta);
 * 2. a chave secreta apaga a conta no Auth (cascata apaga perfil e vínculos);
 * 3. o banco confere que a conta sumiu e marca o pedido como concluído.
 */
export async function concluirExclusao(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.lgpd_exclusao",
    exclusaoSchema,
    form,
    async (rpc, d, trace) => {
      const autorizacao = await rpc("admin_autorizar_exclusao", { p_solicitacao: d.solicitacaoId });
      if (autorizacao.error || typeof autorizacao.data !== "string") {
        return autorizacao.error ? autorizacao : { data: null, error: { code: "P0002", message: "pedido não encontrado" } };
      }
      const { error } = await createAdminAuth().deleteUser(autorizacao.data);
      // Conta já apagada antes (nova tentativa): segue para concluir.
      if (error && error.code !== "user_not_found") {
        log("error", "admin.lgpd_exclusao_auth_falhou", { trace, code: error.code });
        return { data: null, error: { code: "P0002", message: "a conta não foi apagada no login; tente de novo" } };
      }
      return rpc("admin_concluir_exclusao", { p_solicitacao: d.solicitacaoId });
    },
    "Conta excluída e pedido concluído.",
    ADMIN,
  );
  return estado;
}
