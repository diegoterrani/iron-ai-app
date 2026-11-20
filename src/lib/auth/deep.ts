import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { sessaoComMfa } from "@/lib/auth/mfa";
import { exigirContaAtiva, getSessao, type Perfil } from "@/lib/auth/session";
import type { AnalistaDeep } from "@/lib/supabase/servidor";
import { createClient } from "@/lib/supabase/server";

/** Papéis que conduzem o Deep (deep.conduzir na migração 20261120120000). */
const PAPEIS_ANALISTA = new Set(["super_admin", "equipe_iron"]);

/**
 * A tela do Deep aparece para quem tem papel de analista. Só decide o que a
 * TELA mostra: cada leitura passa pelo RLS (deep.conduzir na empresa) e cada
 * operação pelas funções deep_*, que conferem de novo com o MFA.
 */
export const eAnalistaDeep = cache(async (): Promise<boolean> => {
  const sessao = await getSessao();
  return sessao?.perfil?.status === "ativo" && sessao.papeis.some((p) => PAPEIS_ANALISTA.has(p));
});

/** Guarda das páginas /deep: quem não é analista recebe 404 (não confirmamos que a área existe). */
export async function exigirAnalistaDeep(): Promise<Perfil> {
  const perfil = await exigirContaAtiva();
  if (!(await eAnalistaDeep())) notFound();
  return perfil;
}

/**
 * Analista da requisição para as funções do servidor: id confirmado no
 * Supabase (getUser) e se a sessão passou pelo segundo fator. Null quando a
 * sessão expirou ou a conta não está ativa.
 */
export async function analistaDaSessao(): Promise<AnalistaDeep | null> {
  const sessao = await getSessao();
  const userId = sessao?.perfil?.id;
  if (!userId || sessao.perfil?.status !== "ativo") return null;
  if (!sessao.papeis.some((p) => PAPEIS_ANALISTA.has(p))) return null;
  return { userId, aal2: await sessaoComMfa(await createClient()) };
}
