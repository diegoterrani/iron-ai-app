import "server-only";
import { createClient } from "@supabase/supabase-js";
import { adminEnv, publicEnv } from "@/lib/env";

/**
 * Cliente com a chave secreta: ignora RLS. Regra de uso neste projeto:
 * só para chamadas da API de Auth que não existem para usuário comum
 * (hoje: enviar o e-mail de convite) e SEMPRE depois de o banco autorizar
 * a operação com a sessão de quem pediu (ex.: empresa_convidar).
 * Nunca use este cliente para ler ou gravar tabelas.
 */
export function createAdminAuth() {
  const { NEXT_PUBLIC_SUPABASE_URL } = publicEnv();
  const { SUPABASE_SECRET_KEY } = adminEnv();
  const client = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Só a parte de administração de Auth sai daqui.
  return client.auth.admin;
}
