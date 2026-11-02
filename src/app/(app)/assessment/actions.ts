"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { AcaoState } from "@/lib/acao/tipos";
import { getSessao } from "@/lib/auth/session";
import { calcularSelf, RespostaInvalida } from "@/lib/assessment/motor";
import type { Respostas } from "@/lib/assessment/tipos";
import { faltasParaConcluir, modelo, normalizarRascunho, pacote } from "@/lib/assessment/self";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { gravarConclusaoSelf } from "@/lib/supabase/servidor";
import { mensagemErroBanco } from "@/lib/validation/admin";

/**
 * Self assessment: iniciar, salvar rascunho e concluir.
 * Quem decide o acesso é o banco: iniciar_self (direito + conta ativa),
 * RLS no update das respostas e concluir_self (só servidor). Aqui só se
 * valida a forma e se registra no log, sem nunca logar as respostas.
 */

const idSchema = z.uuid();

export async function iniciarSelf(): Promise<AcaoState> {
  const trace = newTraceId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("iniciar_self", { p_setor: "food_service" });
  if (error || typeof data !== "string") {
    log("warn", "self.iniciar.recusado", { trace, code: error?.code });
    return { message: `${mensagemErroBanco(error)} (código ${trace})` };
  }
  log("info", "self.iniciar.ok", { trace });
  redirect(`/assessment/${data}`);
}

export interface SalvarResultado {
  ok: boolean;
  erro?: string;
  salvoEm?: string;
}

/** Autosave do questionário. Grava só `respostas` (único campo que o cliente pode alterar). */
export async function salvarRespostas(id: string, entrada: unknown): Promise<SalvarResultado> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const supabase = await createClient();
  const { data: linha } = await supabase
    .from("assessments")
    .select("setor, status")
    .eq("id", id)
    .maybeSingle<{ setor: string; status: string }>();
  if (!linha) return { ok: false, erro: "Assessment não encontrado." };
  if (linha.status !== "rascunho") return { ok: false, erro: "Este assessment já foi concluído." };

  const norm = normalizarRascunho(entrada, linha.setor);
  if (!norm.ok) return { ok: false, erro: norm.erro };

  const { data, error } = await supabase
    .from("assessments")
    .update({ respostas: norm.respostas })
    .eq("id", id)
    .eq("status", "rascunho")
    .select("atualizado_em")
    .maybeSingle<{ atualizado_em: string }>();
  if (error || !data) {
    const trace = newTraceId();
    log("warn", "self.salvar.recusado", { trace, code: error?.code ?? "sem_linha" });
    return { ok: false, erro: `Não foi possível salvar agora. (código ${trace})` };
  }
  return { ok: true, salvoEm: data.atualizado_em };
}

/**
 * Conclui: lê as respostas com a sessão do dono, confere o direito, roda o
 * motor no servidor e grava o resultado com concluir_self. O banco recusa se
 * as respostas mudaram entre a leitura e a gravação.
 */
export async function concluirSelf(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const id = form.get("assessmentId");
  if (typeof id !== "string" || !idSchema.safeParse(id).success) return { message: "Assessment inválido." };
  const trace = newTraceId();
  const sessao = await getSessao();
  const userId = sessao?.perfil?.id;
  if (!userId || sessao?.perfil?.status !== "ativo") return { message: "Sessão expirada. Entre de novo." };

  const supabase = await createClient();
  const { data: linha } = await supabase
    .from("assessments")
    .select("user_id, org_id, setor, status, respostas")
    .eq("id", id)
    .maybeSingle<{ user_id: string; org_id: string | null; setor: string; status: string; respostas: Respostas }>();
  // RLS deixa empresa e admin LEREM; concluir é só do dono.
  if (!linha || linha.user_id !== userId) return { message: "Assessment não encontrado." };
  if (linha.status !== "rascunho") redirect(`/assessment/${id}/resultado`);

  const { data: temDireito } = await supabase.rpc("tem_direito", {
    p_produto: "self_assessment",
    p_org: linha.org_id,
  });
  if (temDireito !== true) {
    log("warn", "self.concluir.sem_direito", { trace, ator: userId });
    return { message: "Seu acesso ao Self assessment não está liberado." };
  }

  const faltas = faltasParaConcluir(linha.respostas);
  if (faltas.length > 0) return { message: `Faltam respostas: ${faltas.join(" ")}` };

  let resultado;
  try {
    resultado = calcularSelf(linha.respostas, pacote, modelo);
  } catch (err) {
    if (err instanceof RespostaInvalida) {
      // Mensagem do motor descreve a incoerência (ex.: pessoas por área acima do total).
      return { message: `Revise as respostas: ${err.message}.` };
    }
    log("error", "self.concluir.motor_erro", { trace, reason: (err as Error)?.name ?? "desconhecido" });
    return { message: `Não foi possível calcular agora. (código ${trace})` };
  }

  const { error } = await gravarConclusaoSelf({
    assessmentId: id,
    userId,
    hash: resultado.hash_respostas,
    respostas: linha.respostas,
    versoes: resultado.versoes,
    resultado,
  });
  if (error) {
    log("warn", "self.concluir.recusado", { trace, ator: userId, code: error.code });
    return { message: `${mensagemErroBanco(error)} (código ${trace})` };
  }
  log("info", "self.concluir.ok", { trace, ator: userId, motor: resultado.versoes.motor });
  redirect(`/assessment/${id}/resultado`);
}
