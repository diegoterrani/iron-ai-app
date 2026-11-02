import "server-only";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getSessao } from "@/lib/auth/session";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroBanco } from "@/lib/validation/admin";
import { fieldErrors, formToObject } from "@/lib/validation/auth";
import type { AcaoState } from "./tipos";

export type ErroRpc = { code?: string; message?: string } | null;
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: ErroRpc }>;

interface Opcoes {
  /** Checagem rápida da sessão (o banco confere de novo por dentro). */
  autorizar: () => Promise<boolean>;
  /** Caminho a revalidar depois do sucesso. */
  revalidar: string;
}

/**
 * Molde de toda operação que muda dados:
 * 1. valida a entrada com zod;
 * 2. confere a sessão (resposta rápida; quem decide é o banco);
 * 3. chama funções do banco com a sessão de quem pediu (RLS e checagens valem);
 * 4. registra no log quem fez o quê, com código de rastreio;
 * 5. erro do banco vira mensagem segura (sem detalhe de schema).
 * Server actions do Next já checam a origem (proteção CSRF).
 */
export async function executar<S extends z.ZodType>(
  evento: string,
  schema: S,
  form: FormData,
  chamada: (rpc: Rpc, dados: z.output<S>, trace: string) => Promise<{ data: unknown; error: ErroRpc }>,
  sucesso: string,
  opcoes: Opcoes,
): Promise<{ estado: AcaoState; data?: unknown }> {
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { estado: { errors: fieldErrors(parsed.error) } };

  const trace = newTraceId();
  try {
    if (!(await opcoes.autorizar())) {
      log("warn", `${evento}.negado`, { trace });
      return { estado: { message: "Operação não permitida." } };
    }
    const ator = (await getSessao())?.perfil?.id;
    const supabase = await createClient();
    const rpc: Rpc = async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args);
      return { data, error };
    };
    const { data, error } = await chamada(rpc, parsed.data, trace);
    if (error) {
      log("warn", `${evento}.recusado`, { trace, ator, code: error.code });
      return { estado: { message: `${mensagemErroBanco(error)} (código ${trace})` } };
    }
    log("info", `${evento}.ok`, { trace, ator });
    revalidatePath(opcoes.revalidar, "layout");
    return { estado: { ok: true, message: sucesso }, data };
  } catch (err) {
    log("error", `${evento}.erro`, { trace, reason: (err as Error)?.name ?? "desconhecido" });
    return { estado: { message: `Não foi possível concluir agora. (código ${trace})` } };
  }
}
