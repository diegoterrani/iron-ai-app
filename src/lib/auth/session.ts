import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { precisaSegundoFator } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";

export type StatusConta = "pendente" | "ativo" | "suspenso";

export interface Perfil {
  id: string;
  nome: string;
  status: StatusConta;
}

/**
 * Usuário e perfil da requisição atual, uma consulta por renderização.
 * `getUser()` confirma a sessão no servidor do Supabase (não confia no cookie).
 * O perfil vem pelo RLS: cada usuário só lê o próprio.
 */
export const getSessao = cache(
  async (): Promise<{ perfil: Perfil | null; precisaMfa: boolean } | null> => {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;

    const [{ data }, precisaMfa] = await Promise.all([
      supabase.from("profiles").select("id, nome, status").eq("id", auth.user.id).maybeSingle(),
      precisaSegundoFator(supabase),
    ]);
    return { perfil: (data as Perfil | null) ?? null, precisaMfa };
  },
);

/**
 * Exige login completo: quem tem app autenticador precisa ter digitado o
 * código nesta sessão (aal2). Devolve o perfil (pode estar pendente).
 */
export async function exigirLogin(): Promise<Perfil | null> {
  const sessao = await getSessao();
  if (!sessao) redirect("/entrar");
  if (sessao.precisaMfa) redirect("/verificar-mfa");
  return sessao.perfil;
}

/** Exige login e conta ativa (aprovada pelo super-admin). */
export async function exigirContaAtiva(): Promise<Perfil> {
  const perfil = await exigirLogin();
  if (!perfil || perfil.status !== "ativo") redirect("/aguardando-aprovacao");
  return perfil;
}
