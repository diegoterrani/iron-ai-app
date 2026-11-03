import "server-only";
import { createClient } from "@supabase/supabase-js";
import { adminEnv, publicEnv } from "@/lib/env";

/**
 * Operações que só o servidor executa no banco (papel service_role).
 * Expõe UMA função por operação, nunca o cliente: assim ninguém usa a chave
 * secreta para ler ou gravar tabelas por fora do RLS.
 *
 * Regra: só chame depois de autorizar com a sessão do usuário (RLS e
 * tem_direito), como em src/app/(app)/assessment/actions.ts.
 */
function clienteServidor() {
  const { NEXT_PUBLIC_SUPABASE_URL } = publicEnv();
  const { SUPABASE_SECRET_KEY } = adminEnv();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface ConclusaoSelf {
  assessmentId: string;
  userId: string;
  hash: string;
  respostas: unknown;
  versoes: { motor: string; modelo: string; pacote: string };
  resultado: unknown;
}

/** Grava o resultado calculado pelo motor e fecha o rascunho (concluir_self no banco). */
export async function gravarConclusaoSelf(c: ConclusaoSelf) {
  const { data, error } = await clienteServidor().rpc("concluir_self", {
    p_assessment: c.assessmentId,
    p_user: c.userId,
    p_hash: c.hash,
    p_respostas: c.respostas,
    p_motor: c.versoes.motor,
    p_modelo: c.versoes.modelo,
    p_pacote: c.versoes.pacote,
    p_resultado: c.resultado,
  });
  return { data: data as number | null, error: error ? { code: error.code, message: error.message } : null };
}
