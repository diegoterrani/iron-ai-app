import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { fatorTotpVerificado, precisaSegundoFator } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";
import { TERMOS_VERSAO } from "@/lib/validation/auth";

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
  /** Empresas em que é ADM-Cliente (para mostrar "Minha empresa"). */
  gestorDe: string[];
  /** Vínculos com empresas (ADM, RW ou RO-Cliente), para a tela escolher o que mostrar. */
  vinculos: { orgId: string; role: string }[];
  /** Empresas que a pessoa atende como Equipe IRON ou parceiro (staff_assignments). */
  atendidas: string[];
  /** Ainda não aceitou a versão atual dos Termos (ex.: entrou pelo Google ou por convite). */
  precisaAceitarTermos: boolean;
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

  const [perfilRes, papeisRes, vinculosRes, atendidasRes, precisaMfa, fator] = await Promise.all([
    supabase.from("profiles").select("id, nome, status, aceite_termos_versao").eq("id", auth.user.id).maybeSingle(),
    supabase.from("user_roles").select("role, roles(exige_mfa)").eq("user_id", auth.user.id),
    supabase.from("memberships").select("org_id, role").eq("user_id", auth.user.id),
    supabase.from("staff_assignments").select("org_id").eq("user_id", auth.user.id),
    precisaSegundoFator(supabase),
    fatorTotpVerificado(supabase),
  ]);

  const linhas = (papeisRes.data ?? []) as unknown as { role: string; roles: { exige_mfa: boolean } | null }[];
  const exigeMfa = linhas.some((l) => l.roles?.exige_mfa === true);
  const vinculos = ((vinculosRes.data ?? []) as { org_id: string; role: string }[]).map((m) => ({ orgId: m.org_id, role: m.role }));

  const perfilBruto = perfilRes.data as (Perfil & { aceite_termos_versao: string | null }) | null;
  const atendidas = ((atendidasRes.data ?? []) as { org_id: string }[]).map((a) => a.org_id);

  return {
    perfil: perfilBruto ? { id: perfilBruto.id, nome: perfilBruto.nome, status: perfilBruto.status } : null,
    papeis: linhas.map((l) => l.role),
    gestorDe: vinculos.filter((v) => v.role === "adm_cliente").map((v) => v.orgId),
    vinculos,
    atendidas,
    // Sem perfil (caso anômalo) não pede aceite: as outras guardas já barram.
    precisaAceitarTermos: perfilBruto !== null && perfilBruto.aceite_termos_versao !== TERMOS_VERSAO,
    precisaMfa,
    precisaCadastrarMfa: exigeMfa && !fator,
  };
});

/**
 * Exige login completo: quem tem app autenticador precisa ter digitado o
 * código nesta sessão (aal2) e quem ainda não aceitou a versão atual dos
 * Termos passa pela tela de aceite. Devolve o perfil (pode estar pendente).
 * `permitirSemAceite`: só para telas de direitos do titular (LGPD) e a
 * própria tela de aceite, que precisam funcionar antes do aceite.
 */
export async function exigirLogin(opcoes: { permitirSemAceite?: boolean } = {}): Promise<Perfil | null> {
  const sessao = await getSessao();
  if (!sessao) redirect("/entrar");
  if (sessao.precisaMfa) redirect("/verificar-mfa");
  if (sessao.precisaAceitarTermos && !opcoes.permitirSemAceite) redirect("/aceitar-termos");
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
