"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { AcaoState } from "@/lib/acao/tipos";
import { getSessao } from "@/lib/auth/session";
import { calcularSelf, RespostaInvalida } from "@/lib/assessment/motor";
import type { Respostas } from "@/lib/assessment/tipos";
import type { EmpresaSelf } from "@/lib/assessment/questionario";
import {
  faltasParaConcluir,
  modelo,
  montarQuestionario,
  normalizarEmpresa,
  normalizarRascunho,
  pacote,
} from "@/lib/assessment/self";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { gravarConclusaoSelf, gravarConversa, reservarTurnoConversa } from "@/lib/supabase/servidor";
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_TEXTO_CLIENTE, chamarAnthropic, executarTurno, falasParaTela, type FalaTela } from "@/lib/assessment/agente/conversa";
import type { CampoSeguro, Sinal } from "@/lib/assessment/agente/ferramentas";
import type { RespostasSelf } from "@/lib/assessment/questionario";
import { cnpjValido } from "@/lib/validation/cnpj";
import { agenteConfigurado, llmEnv } from "@/lib/env";
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

/**
 * Autosave do questionário. Grava só `respostas` e `empresa`, as únicas
 * colunas que o cliente pode alterar (e só enquanto é rascunho).
 */
export async function salvarRascunho(id: string, entrada: { respostas?: unknown; empresa?: unknown }): Promise<SalvarResultado> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const supabase = await createClient();
  const { data: linha } = await supabase
    .from("assessments")
    .select("setor, status")
    .eq("id", id)
    .maybeSingle<{ setor: string; status: string }>();
  if (!linha) return { ok: false, erro: "Assessment não encontrado." };
  if (linha.status !== "rascunho") return { ok: false, erro: "Este assessment já foi concluído." };

  const norm = normalizarRascunho(entrada?.respostas ?? {}, linha.setor);
  if (!norm.ok) return { ok: false, erro: norm.erro };
  const emp = normalizarEmpresa(entrada?.empresa ?? {});
  if (!emp.ok) return { ok: false, erro: emp.erro };

  const { data, error } = await supabase
    .from("assessments")
    .update({ respostas: norm.respostas, empresa: emp.empresa })
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
    .select("user_id, org_id, setor, status, respostas, empresa")
    .eq("id", id)
    .maybeSingle<{
      user_id: string;
      org_id: string | null;
      setor: string;
      status: string;
      respostas: Respostas;
      empresa: EmpresaSelf;
    }>();
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

  const faltas = faltasParaConcluir(linha.respostas, linha.empresa ?? {});
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

// ------------------------------------------------------------- conversa com o agente

export type EntradaConversa =
  | { tipo: "mensagem"; texto: string }
  | { tipo: "inicio" }
  | { tipo: "campo_preenchido"; campo: CampoSeguro };

export interface RespostaConversa {
  ok: boolean;
  erro?: string;
  falas?: FalaTela[];
  sinais?: Sinal[];
  respostas?: RespostasSelf;
  empresa?: EmpresaSelf;
}

const entradaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("mensagem"), texto: z.string().trim().min(1, "Escreva uma mensagem.").max(MAX_TEXTO_CLIENTE, `Use até ${MAX_TEXTO_CLIENTE} caracteres.`) }),
  z.object({ tipo: z.literal("inicio") }),
  z.object({ tipo: z.literal("campo_preenchido"), campo: z.enum(["cnpj", "contato_telefone"]) }),
]);

const AVISO = "[Aviso do app]";
const ROTULO_SEGURO: Record<CampoSeguro, string> = { cnpj: "CNPJ", contato_telefone: "telefone" };

/** Texto que vai ao agente. Avisos são montados aqui; o cliente não consegue se passar pelo app. */
function textoParaAgente(e: z.infer<typeof entradaSchema>, empresa: EmpresaSelf): string {
  if (e.tipo === "inicio") return `${AVISO} O cliente abriu a conversa. Apresente-se e comece pelo cadastro.`;
  if (e.tipo === "campo_preenchido") {
    const valido = e.campo === "cnpj" ? Boolean(empresa.cnpj && cnpjValido(empresa.cnpj)) : Boolean(empresa.contato_telefone);
    return valido
      ? `${AVISO} O cliente preencheu o ${ROTULO_SEGURO[e.campo]} no campo seguro e o app validou.`
      : `${AVISO} O ${ROTULO_SEGURO[e.campo]} não foi preenchido corretamente no campo seguro.`;
  }
  // Remove um prefixo de aviso digitado pelo cliente.
  return e.texto.replaceAll(AVISO, "").trim() || "(mensagem vazia)";
}

/** Abre a conversa: devolve as falas gravadas (o titular lê a própria conversa pelo RLS). */
export async function lerConversa(id: string): Promise<RespostaConversa> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("assessment_conversas")
    .select("mensagens, expira_em")
    .eq("assessment_id", id)
    .maybeSingle<{ mensagens: unknown[]; expira_em: string }>();
  const vigente = data && new Date(data.expira_em) > new Date();
  return { ok: true, falas: vigente ? falasParaTela(data.mensagens) : [] };
}

/**
 * Um turno da conversa. Ordem de segurança:
 * 1. forma da entrada (zod); 2. sessão e conta ativa; 3. dono e rascunho
 * pelo RLS; 4. direito ao produto; 5. turno reservado no banco (teto);
 * 6. agente responde e propõe respostas, validadas pelas ferramentas;
 * 7. respostas gravadas com a sessão do usuário; 8. conversa gravada.
 * O texto da conversa nunca vai para o log, só tamanhos e uso de tokens.
 */
export async function conversarSelf(id: string, entrada: EntradaConversa): Promise<RespostaConversa> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const e = entradaSchema.safeParse(entrada);
  if (!e.success) return { ok: false, erro: e.error.issues[0]?.message ?? "Mensagem inválida." };
  const trace = newTraceId();
  if (!agenteConfigurado()) {
    log("error", "self.conversa.sem_config", { trace });
    return { ok: false, erro: `A conversa está indisponível agora. Use o formulário. (código ${trace})` };
  }

  const sessao = await getSessao();
  const userId = sessao?.perfil?.id;
  if (!userId || sessao?.perfil?.status !== "ativo") return { ok: false, erro: "Sessão expirada. Entre de novo." };

  const supabase = await createClient();
  const { data: linha } = await supabase
    .from("assessments")
    .select("user_id, org_id, setor, status, respostas, empresa")
    .eq("id", id)
    .maybeSingle<{ user_id: string; org_id: string | null; setor: string; status: string; respostas: RespostasSelf; empresa: EmpresaSelf }>();
  if (!linha || linha.user_id !== userId) return { ok: false, erro: "Assessment não encontrado." };
  if (linha.status !== "rascunho") return { ok: false, erro: "Este assessment já foi concluído." };

  const { data: temDireito } = await supabase.rpc("tem_direito", { p_produto: "self_assessment", p_org: linha.org_id });
  if (temDireito !== true) return { ok: false, erro: "Seu acesso ao Self assessment não está liberado." };

  const reserva = await reservarTurnoConversa(id, userId);
  if (reserva.error) {
    log("warn", "self.conversa.reserva_recusada", { trace, ator: userId, code: reserva.error.code });
    const limite = reserva.error.message.includes("limite");
    return {
      ok: false,
      erro: limite
        ? "A conversa chegou ao limite de mensagens. Continue pelo formulário: nada do que você respondeu se perde."
        : `Não foi possível continuar a conversa agora. (código ${trace})`,
    };
  }

  const empresa = linha.empresa ?? {};
  const inicio = Date.now();
  let turno;
  try {
    turno = await executarTurno({
      q: montarQuestionario(),
      historico: reserva.historico as Anthropic.Beta.BetaMessageParam[],
      entrada: textoParaAgente(e.data, empresa),
      estado: { setor: linha.setor, respostas: linha.respostas ?? {}, empresa },
      chamar: chamarAnthropic(llmEnv().ANTHROPIC_API_KEY),
    });
  } catch (err) {
    // Erro tipado do SDK: só o nome e o status vão ao log, nunca a mensagem do cliente.
    const status = (err as { status?: number })?.status;
    log("error", "self.conversa.llm_erro", { trace, ator: userId, reason: (err as Error)?.name ?? "desconhecido", status });
    return { ok: false, erro: `O assistente não respondeu agora. Tente de novo em instantes. (código ${trace})` };
  }

  if (turno.alterou) {
    const { error } = await supabase
      .from("assessments")
      .update({ respostas: turno.estado.respostas, empresa: turno.estado.empresa })
      .eq("id", id)
      .eq("status", "rascunho");
    if (error) {
      log("warn", "self.conversa.salvar_recusado", { trace, ator: userId, code: error.code });
      return { ok: false, erro: `Não foi possível salvar as respostas. (código ${trace})` };
    }
  }

  const gravacao = await gravarConversa(id, userId, turno.historico, turno.uso);
  if (gravacao.error) {
    log("warn", "self.conversa.gravar_recusado", { trace, ator: userId, code: gravacao.error.code });
    return { ok: false, erro: `A conversa mudou em outra aba. Recarregue a página. (código ${trace})` };
  }

  log("info", "self.conversa.turno", {
    trace,
    ator: userId,
    fim: turno.fim,
    ms: Date.now() - inicio,
    tokens_entrada: turno.uso.entrada,
    tokens_saida: turno.uso.saida,
    cache_leitura: turno.uso.cacheLeitura,
    cache_escrita: turno.uso.cacheEscrita,
  });

  const textos =
    turno.fim === "recusa"
      ? ["Não consigo seguir com esse pedido. Vamos continuar o assessment? Se preferir, use o formulário."]
      : turno.textos.length > 0
        ? turno.textos
        : ["Pode continuar, estou acompanhando."];
  return {
    ok: true,
    falas: textos.map((texto) => ({ autor: "agente" as const, texto })),
    sinais: turno.sinais,
    respostas: turno.estado.respostas,
    empresa: turno.estado.empresa,
  };
}
