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

export interface UsoConversa {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

/**
 * Reserva um turno da conversa antes de chamar o LLM (teto de 60 no banco) e
 * devolve o histórico. O banco confere dono, rascunho e conta ativa.
 */
export async function reservarTurnoConversa(assessmentId: string, userId: string) {
  const { data, error } = await clienteServidor().rpc("conversa_reservar_turno", {
    p_assessment: assessmentId,
    p_user: userId,
  });
  return { historico: (data ?? []) as unknown[], error: error ? { code: error.code, message: error.message } : null };
}

/** Grava o histórico (só cresce) e soma o uso de tokens do turno. */
export async function gravarConversa(assessmentId: string, userId: string, historico: unknown[], uso: UsoConversa) {
  const { error } = await clienteServidor().rpc("conversa_gravar", {
    p_assessment: assessmentId,
    p_user: userId,
    p_mensagens: historico,
    p_tokens_entrada: uso.entrada,
    p_tokens_saida: uso.saida,
    p_tokens_cache_leitura: uso.cacheLeitura,
    p_tokens_cache_escrita: uso.cacheEscrita,
  });
  return { error: error ? { code: error.code, message: error.message } : null };
}
