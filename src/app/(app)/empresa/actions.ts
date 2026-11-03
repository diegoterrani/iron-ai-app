"use server";

import { executar } from "@/lib/acao/executar";
import type { AcaoState } from "@/lib/acao/tipos";
import { eGestorDeEmpresa } from "@/lib/auth/empresa";
import { siteUrl } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminAuth } from "@/lib/supabase/admin";
import { conviteIdSchema, conviteSchema, desvinculoSchema } from "@/lib/validation/admin";

/**
 * Operações do Master B2B na própria empresa. A permissão é conferida no
 * banco (tem_permissao('empresa.membros', empresa)) a cada chamada.
 */

const GESTOR = { autorizar: eGestorDeEmpresa, revalidar: "/empresa" };

/** Erros da API de convite que significam "a pessoa já tem conta": não é falha. */
const JA_TEM_CONTA = new Set(["email_exists", "user_already_exists"]);

export async function convidarMembro(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "empresa.convidar",
    conviteSchema,
    form,
    async (rpc, d, trace) => {
      // 1. O banco autoriza e reserva o assento (com a sessão do Master).
      const registro = await rpc("empresa_convidar", { p_org: d.orgId, p_email: d.email });
      if (registro.error) return registro;

      // 2. Só então a chave secreta envia o e-mail. Quem já tem conta não
      //    recebe e-mail novo e verá o convite ao entrar; a resposta ao Master
      //    é a mesma nos dois casos (não revela quem tem conta).
      const { error } = await createAdminAuth().inviteUserByEmail(d.email, {
        redirectTo: `${siteUrl()}/redefinir-senha`,
      });
      if (error && !JA_TEM_CONTA.has(error.code ?? "")) {
        log("error", "empresa.convite_email_falhou", { trace, code: error.code });
        // Código de mensagem própria (exibida ao Master como está).
        return {
          data: null,
          error: { code: "P0002", message: "o convite foi registrado, mas o e-mail não saiu; cancele e convide de novo" },
        };
      }
      return { data: null, error: null };
    },
    "Convite registrado. Se a pessoa ainda não tem conta, ela recebe um e-mail; se já tem, verá o convite ao entrar.",
    GESTOR,
  );
  return estado;
}

export async function cancelarConvite(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "empresa.convite_cancelar",
    conviteIdSchema,
    form,
    (rpc, d) => rpc("empresa_cancelar_convite", { p_convite: d.conviteId }),
    "Convite cancelado.",
    GESTOR,
  );
  return estado;
}

export async function removerMembro(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "empresa.remover_membro",
    desvinculoSchema,
    form,
    (rpc, d) => rpc("empresa_remover_membro", { p_org: d.orgId, p_user: d.userId }),
    "Pessoa removida da empresa.",
    GESTOR,
  );
  return estado;
}
