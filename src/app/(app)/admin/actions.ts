"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { podeUsarBackoffice } from "@/lib/auth/admin";
import { getSessao } from "@/lib/auth/session";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import {
  assentosSchema,
  desvinculoSchema,
  empresaSchema,
  mensagemErroBanco,
  papelSchema,
  staffSchema,
  statusSchema,
  vinculoSchema,
} from "@/lib/validation/admin";
import { fieldErrors, formToObject } from "@/lib/validation/auth";

/**
 * Operações do backoffice. Cada uma:
 * 1. confere a sessão (só para responder rápido; o banco confere de novo);
 * 2. valida a entrada com zod;
 * 3. chama UMA função admin_* do banco (security definer, auditada);
 * 4. registra no log quem fez o quê, com código de rastreio.
 * Server actions do Next já checam a origem (proteção CSRF).
 */

export interface AcaoState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function executar<S extends z.ZodType>(
  evento: string,
  schema: S,
  form: FormData,
  chamada: (rpc: Rpc, dados: z.output<S>) => ReturnType<Rpc>,
  sucesso: string,
): Promise<{ estado: AcaoState; data?: unknown }> {
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { estado: { errors: fieldErrors(parsed.error) } };

  const trace = newTraceId();
  try {
    if (!(await podeUsarBackoffice())) {
      log("warn", `${evento}.negado`, { trace });
      return { estado: { message: "Operação não permitida." } };
    }
    const ator = (await getSessao())?.perfil?.id;
    const supabase = await createClient();
    const rpc: Rpc = async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args);
      return { data, error };
    };
    const { data, error } = await chamada(rpc, parsed.data);
    if (error) {
      log("warn", `${evento}.recusado`, { trace, ator, code: error.code });
      return { estado: { message: `${mensagemErroBanco(error)} (código ${trace})` } };
    }
    log("info", `${evento}.ok`, { trace, ator });
    revalidatePath("/admin", "layout");
    return { estado: { ok: true, message: sucesso }, data };
  } catch (err) {
    log("error", `${evento}.erro`, { trace, reason: (err as Error)?.name ?? "desconhecido" });
    return { estado: { message: `Não foi possível concluir agora. (código ${trace})` } };
  }
}

export async function definirStatus(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "admin.status",
    statusSchema,
    form,
    (rpc, d) => rpc("admin_definir_status", { p_user: d.userId, p_status: d.status }),
    "Status atualizado.",
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
  );
  return estado;
}
