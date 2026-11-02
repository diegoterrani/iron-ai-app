import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { fatorTotpVerificado, precisaSegundoFator } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";

export type StatusConta = "pendente" | "ativo" | "suspenso";

export interface Perfil {
  id: string;
  nome: string;
  status: StatusConta;
}

export interface Sessao {
  perfil: Perfil | null;
  /** Papéis globais (super_admin, equipe_iron, parceiro, aluno_b2c). */
  papeis: string[];
  /** Tem app autenticador ativo mas a sessão ainda está em aal1. */
  precisaMfa: boolean;
  /** Algum papel exige MFA (staff) e o usuário ainda não ativou. */
  precisaCadastrarMfa: boolean;
}

/**
 * Sessão da requisição atual, uma consulta por renderização.
 * `getUser()` confirma a sessão no servidor do Supabase (não confia no cookie).
 * Perfil e papéis vêm pelo RLS: cada usuário só lê os próprios.
 * Isto serve para a tela; a decisão de acesso a dados é do banco (tem_permissao).
 */
export const getSessao = cache(async (): Promise<Sessao | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [perfilRes, papeisRes, precisaMfa, fator] = await Promise.all([
    supabase.from("profiles").select("id, nome, status").eq("id", auth.user.id).maybeSingle(),
    supabase.from("user_roles").select("role, roles(exige_mfa)").eq("user_id", auth.user.id),
    precisaSegundoFator(supabase),
    fatorTotpVerificado(supabase),
  ]);

  const linhas = (papeisRes.data ?? []) as unknown as { role: string; roles: { exige_mfa: boolean } | null }[];
  const exigeMfa = linhas.some((l) => l.roles?.exige_mfa === true);

  return {
    perfil: (perfilRes.data as Perfil | null) ?? null,
    papeis: linhas.map((l) => l.role),
    precisaMfa,
    precisaCadastrarMfa: exigeMfa && !fator,
  };
});

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

/**
 * Exige conta ativa. Staff (Super-admin, Equipe IRON) sem MFA é levado a
 * ativar antes de qualquer tela: no banco, os papéis deles nem valem sem aal2.
 */
export async function exigirContaAtiva(): Promise<Perfil> {
  const perfil = await exigirLogin();
  if (!perfil || perfil.status !== "ativo") redirect("/aguardando-aprovacao");
  const sessao = await getSessao();
  if (sessao?.precisaCadastrarMfa) redirect("/configurar-mfa");
  return perfil;
}
