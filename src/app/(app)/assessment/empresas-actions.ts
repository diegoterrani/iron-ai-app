"use server";

import { z } from "zod";
import { getSessao } from "@/lib/auth/session";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/**
 * Cadastro de empresas do Self. Quem decide o que cada um vê é o banco
 * (RLS de empresas_cadastro: quem cadastrou e a equipe IRON com MFA); o
 * vínculo passa por vincular_empresa_assessment, que confere se a pessoa
 * pode editar o rascunho e ver a empresa. Aqui só valida a forma e registra.
 */

export interface EmpresaEncontrada {
  id: string;
  nome: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  contatoNome: string | null;
}

export type Resposta<T = object> = ({ ok: true } & T) | { ok: false; erro: string };

const termoSchema = z.string().max(100);
const idSchema = z.uuid();

/** Busca no cadastro por nome, cidade, UF ou CNPJ (sem termo: as mais recentes). */
export async function buscarEmpresas(termo: string): Promise<Resposta<{ empresas: EmpresaEncontrada[] }>> {
  const t = termoSchema.safeParse(termo ?? "");
  if (!t.success) return { ok: false, erro: "Busca longa demais." };
  const sessao = await getSessao();
  if (!sessao?.perfil || sessao.perfil.status !== "ativo") return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("buscar_empresas_cadastro", { p_termo: t.data });
  if (error) {
    const trace = newTraceId();
    log("warn", "empresas.busca_falhou", { trace, ator: sessao.perfil.id, code: error.code });
    return { ok: false, erro: `Não foi possível buscar agora. (código ${trace})` };
  }
  const linhas = (data ?? []) as { id: string; nome: string; cnpj: string | null; cidade: string | null; uf: string | null; contato_nome: string | null }[];
  return {
    ok: true,
    empresas: linhas.map((l) => ({ id: l.id, nome: l.nome, cnpj: l.cnpj, cidade: l.cidade, uf: l.uf, contatoNome: l.contato_nome })),
  };
}

/**
 * Usa uma empresa do cadastro neste rascunho (copia os dados) ou, com
 * empresaId nulo, desfaz o vínculo e limpa os dados para cadastrar uma nova.
 */
export async function vincularEmpresa(assessmentId: string, empresaId: string | null): Promise<Resposta> {
  if (!idSchema.safeParse(assessmentId).success || (empresaId !== null && !idSchema.safeParse(empresaId).success)) {
    return { ok: false, erro: "Pedido inválido." };
  }
  const sessao = await getSessao();
  if (!sessao?.perfil || sessao.perfil.status !== "ativo") return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const supabase = await createClient();
  const trace = newTraceId();
  const { error } = await supabase.rpc("vincular_empresa_assessment", { p_assessment: assessmentId, p_empresa: empresaId });
  if (error) {
    log("warn", "empresas.vinculo_recusado", { trace, ator: sessao.perfil.id, code: error.code });
    if (error.message.includes("empresa não encontrada")) return { ok: false, erro: "Empresa não encontrada." };
    return { ok: false, erro: `Não foi possível usar esta empresa agora. (código ${trace})` };
  }
  log("info", "empresas.vinculo", { trace, ator: sessao.perfil.id, nova: empresaId === null });
  return { ok: true };
}
