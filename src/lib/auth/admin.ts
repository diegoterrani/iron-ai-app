import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { exigirContaAtiva, getSessao, type Perfil } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Pergunta ao banco se a sessão atual pode usar o backoffice.
 * tem_permissao confere conta ativa, papel super_admin e MFA (aal2) a cada
 * chamada. Esta checagem só decide o que a TELA mostra: cada função admin_*
 * repete a verificação por dentro.
 */
export const podeUsarBackoffice = cache(async (): Promise<boolean> => {
  const sessao = await getSessao();
  if (!sessao?.papeis.includes("super_admin")) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tem_permissao", { p_permissao: "admin.backoffice" });
  return !error && data === true;
});

/**
 * Guarda das páginas /admin. Quem não é super-admin recebe 404 (não
 * confirmamos que a área existe).
 */
export async function exigirSuperAdmin(): Promise<Perfil> {
  const perfil = await exigirContaAtiva();
  if (!(await podeUsarBackoffice())) notFound();
  return perfil;
}
