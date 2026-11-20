"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { AcaoState } from "@/lib/acao/tipos";
import { chamarAnthropic, detalheErroApi, separarBaloes } from "@/lib/assessment/agente/conversa";
import { ErroReuniao, turnoDaReuniao } from "@/lib/assessment/deep/agente/reuniao";
import { EntradaInvalida, MAX_TEXTO_ANALISTA } from "@/lib/assessment/deep/agente/turno";
import { roteiroDeep } from "@/lib/assessment/deep/roteiro";
import { AVISO_APP, areaValida, participantesDoTexto, semAvisoDoApp, valorDoFormulario, type FalaReuniao } from "@/lib/assessment/deep/tela";
import { analistaDaSessao } from "@/lib/auth/deep";
import { agenteConfigurado, llmEnv } from "@/lib/env";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import {
  deepAbrir,
  deepAbrirSessao,
  deepEncerrarSessao,
  deepFecharPendencia,
  deepRegistrarRespostas,
} from "@/lib/supabase/servidor";
import { mensagemErroBanco } from "@/lib/validation/admin";

/**
 * Deep assessment, modo analista. Só o analista da IRON usa estas telas.
 * Ordem de segurança em toda ação: forma da entrada (zod), sessão ativa
 * com papel de analista, e então a função deep_* do banco, que confere
 * deep.conduzir na empresa e o MFA de novo. Nada do que foi dito na
 * reunião vai para o log: só ids, tamanhos, contagens e uso de tokens.
 */

const id = z.uuid();
const SESSAO_EXPIRADA = "Sessão expirada ou sem permissão. Entre de novo.";

function erroDoBanco(evento: string, trace: string, ator: string, error: { code: string; message: string }): AcaoState {
  log("warn", `${evento}.recusado`, { trace, ator, code: error.code });
  return { message: `${mensagemErroBanco(error)} (código ${trace})` };
}

// ------------------------------------------------------------ abrir o Deep

const abrirSchema = z.object({ orgId: id });

/** Abre o Deep da empresa ou retoma o que está em andamento (o banco decide). */
export async function abrirDeep(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const d = abrirSchema.safeParse({ orgId: form.get("orgId") });
  if (!d.success) return { message: "Escolha a empresa." };
  const trace = newTraceId();
  const analista = await analistaDaSessao();
  if (!analista) return { message: SESSAO_EXPIRADA };

  // Self concluído mais recente da empresa, se o analista puder lê-lo: o
  // relatório do Deep parte dele. Sem acesso, o Deep abre sem o vínculo.
  const supabase = await createClient();
  const { data: self } = await supabase
    .from("assessments")
    .select("id")
    .eq("org_id", d.data.orgId)
    .eq("status", "concluido")
    .order("concluido_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const r = await deepAbrir(analista, {
    orgId: d.data.orgId,
    setor: roteiroDeep.pacote,
    pacoteVersao: roteiroDeep.pacoteVersao,
    selfAssessmentId: self?.id ?? null,
  });
  if (r.error || !r.id) return erroDoBanco("deep.abrir", trace, analista.userId, r.error ?? { code: "sem_id", message: "" });
  log("info", "deep.abrir.ok", { trace, ator: analista.userId, deep: r.id, com_self: Boolean(self) });
  redirect(`/deep/${r.id}`);
}

// ------------------------------------------------------------ abrir reunião

const reuniaoSchema = z.object({
  deepId: id,
  area: z.string().refine(areaValida, "Escolha a área."),
  titulo: z.string().trim().min(2, "Dê um título à reunião.").max(200, "Título até 200 caracteres."),
  participantes: z.string().max(5000, "Lista de participantes longa demais."),
});

/** Começa uma reunião da área ou retoma a que está aberta. */
export async function abrirReuniao(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const d = reuniaoSchema.safeParse({
    deepId: form.get("deepId"),
    area: form.get("area"),
    titulo: form.get("titulo") ?? "",
    participantes: form.get("participantes") ?? "",
  });
  if (!d.success) return { message: d.error.issues[0]?.message ?? "Dados inválidos." };
  const p = participantesDoTexto(d.data.participantes);
  if (!p.ok) return { message: p.erro };

  const trace = newTraceId();
  const analista = await analistaDaSessao();
  if (!analista) return { message: SESSAO_EXPIRADA };
  const r = await deepAbrirSessao(d.data.deepId, analista, { area: d.data.area, titulo: d.data.titulo, participantes: p.participantes });
  if (r.error || !r.id) return erroDoBanco("deep.reuniao_abrir", trace, analista.userId, r.error ?? { code: "sem_id", message: "" });
  log("info", "deep.reuniao_abrir.ok", { trace, ator: analista.userId, deep: d.data.deepId, sessao: r.id, participantes: p.participantes.length });
  redirect(`/deep/${d.data.deepId}/reuniao/${r.id}`);
}

// ------------------------------------------------------- falar com o agente

export type EntradaReuniao = { tipo: "mensagem"; texto: string } | { tipo: "inicio" } | { tipo: "encerrar" };

export interface RespostaReuniao {
  ok: boolean;
  erro?: string;
  falas?: FalaReuniao[];
  /** Resumo proposto pelo agente (encerrar_reuniao): o analista revisa antes de gravar. */
  resumo?: string;
  /** Quantos itens o agente gravou neste turno. */
  gravou?: { respostas: number; evidencias: number; pendencias: number };
  /** Quantos dados sensíveis foram mascarados na fala do analista. */
  mascarados?: number;
}

const entradaSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("mensagem"),
    texto: z.string().trim().min(1, "Escreva o que foi respondido.").max(MAX_TEXTO_ANALISTA, `Use até ${MAX_TEXTO_ANALISTA} caracteres.`),
  }),
  z.object({ tipo: z.literal("inicio") }),
  z.object({ tipo: z.literal("encerrar") }),
]);

/** Texto que vai ao agente. Avisos são montados aqui; o analista não consegue se passar pelo app. */
function textoParaAgente(e: z.infer<typeof entradaSchema>): string {
  if (e.tipo === "inicio") {
    return `${AVISO_APP} A reunião começou. Cumprimente o analista em uma frase e traga a primeira pergunta da fila desta área.`;
  }
  if (e.tipo === "encerrar") {
    return `${AVISO_APP} O analista pediu para encerrar a reunião. Chame encerrar_reuniao com o resumo.`;
  }
  return semAvisoDoApp(e.texto) || "(mensagem vazia)";
}

function mensagemErroReuniao(err: ErroReuniao, trace: string): string {
  if (err.codigo === "pacote_diferente") return `Este Deep foi aberto com outra versão do roteiro. Fale com o suporte. (código ${trace})`;
  if (err.etapa === "reservar" && err.codigo === "23514") {
    return "A reunião não aceita novas falas: ela foi encerrada ou chegou ao limite de turnos. Encerre e abra outra reunião.";
  }
  if (err.codigo === "42501") return "Sem permissão para conduzir este Deep (confira o MFA e a atribuição à empresa).";
  return `Não foi possível concluir o turno. (código ${trace})`;
}

/**
 * Um turno da reunião: o analista digita o que foi respondido, o agente
 * grava as respostas pelas funções do banco e devolve a próxima pergunta.
 */
export async function falarNaReuniao(deepId: string, sessaoId: string, entrada: EntradaReuniao): Promise<RespostaReuniao> {
  if (!id.safeParse(deepId).success || !id.safeParse(sessaoId).success) return { ok: false, erro: "Reunião inválida." };
  const e = entradaSchema.safeParse(entrada);
  if (!e.success) return { ok: false, erro: e.error.issues[0]?.message ?? "Mensagem inválida." };
  const trace = newTraceId();
  if (!agenteConfigurado()) {
    log("error", "deep.turno.sem_config", { trace });
    return { ok: false, erro: `O agente está indisponível agora (chave da API não configurada). (código ${trace})` };
  }
  const analista = await analistaDaSessao();
  if (!analista) return { ok: false, erro: SESSAO_EXPIRADA };

  // A abertura só vale para reunião sem falas: recarregar a página não gasta turno.
  if (e.data.tipo === "inicio") {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("deep_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("sessao_id", sessaoId);
    if (error) return { ok: false, erro: `Não foi possível abrir a reunião. (código ${trace})` };
    if ((count ?? 0) > 0) return { ok: true, falas: [] };
  }

  const inicio = Date.now();
  let r;
  try {
    r = await turnoDaReuniao({
      deepId,
      sessaoId,
      analista,
      texto: textoParaAgente(e.data),
      chamar: chamarAnthropic(llmEnv().ANTHROPIC_API_KEY),
    });
  } catch (err) {
    if (err instanceof ErroReuniao) {
      log("warn", "deep.turno.recusado", { trace, ator: analista.userId, sessao: sessaoId, etapa: err.etapa, code: err.codigo });
      return { ok: false, erro: mensagemErroReuniao(err, trace) };
    }
    if (err instanceof EntradaInvalida) return { ok: false, erro: "Mensagem vazia ou longa demais." };
    log("error", "deep.turno.llm_erro", { trace, ator: analista.userId, sessao: sessaoId, ...detalheErroApi(err) });
    return { ok: false, erro: `O agente não respondeu agora. O que você digitou continua na caixa; tente de novo. (código ${trace})` };
  }

  const gravou = { respostas: 0, evidencias: 0, pendencias: 0 };
  let resumo: string | undefined;
  for (const s of r.sinais) {
    if (s.tipo === "resumo_reuniao") resumo = s.resumo;
    if (s.tipo === "gravou") {
      gravou.respostas += s.respostas;
      gravou.evidencias += s.evidencias;
      gravou.pendencias += s.pendencias;
    }
  }
  const mascarados = Object.values(r.mascarados).reduce((a, b) => a + b, 0);
  log("info", "deep.turno.ok", {
    trace,
    ator: analista.userId,
    sessao: sessaoId,
    tipo: e.data.tipo,
    fim: r.fim,
    ms: Date.now() - inicio,
    tamanho: e.data.tipo === "mensagem" ? e.data.texto.length : 0,
    mascarados,
    ...gravou,
    tokens_entrada: r.uso.entrada,
    tokens_saida: r.uso.saida,
    cache_leitura: r.uso.cacheLeitura,
    cache_escrita: r.uso.cacheEscrita,
  });

  const textos =
    r.fim === "recusa"
      ? ["Não consigo seguir com esse pedido. Vamos voltar ao roteiro?"]
      : r.textos.length > 0
        ? r.textos
        : [r.fim === "ok" ? "Registrado. Pode seguir." : "O agente não terminou a resposta. Repita a última informação, se precisar."];
  const falas: FalaReuniao[] = textos.flatMap((t) => separarBaloes(t).map((texto) => ({ autor: "agente" as const, texto })));
  if (gravou.respostas + gravou.evidencias + gravou.pendencias > 0) revalidatePath(`/deep/${deepId}`, "layout");
  return { ok: true, falas, resumo, gravou, mascarados };
}

// ------------------------------------------------------ correção manual

const CONFIANCAS = ["alta", "media", "baixa"] as const;
const correcaoSchema = z.object({
  deepId: id,
  sessaoId: id,
  perguntaId: z.string().max(80),
  confianca: z.enum(CONFIANCAS, "Escolha a confiança."),
  naoSeAplica: z.boolean(),
  texto: z.string().max(2000, "Texto até 2000 caracteres."),
  opcoes: z.array(z.string().max(40)).max(40),
});

/**
 * O analista corrige ou preenche uma resposta sem passar pelo agente. Grava
 * uma nova versão (a anterior fica no histórico), com as mesmas validações
 * do roteiro que o agente usa.
 */
export async function corrigirResposta(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const d = correcaoSchema.safeParse({
    deepId: form.get("deepId"),
    sessaoId: form.get("sessaoId"),
    perguntaId: form.get("perguntaId"),
    confianca: form.get("confianca"),
    naoSeAplica: form.get("naoSeAplica") === "on",
    texto: form.get("texto") ?? "",
    opcoes: form.getAll("opcoes").filter((v): v is string => typeof v === "string"),
  });
  if (!d.success) return { message: d.error.issues[0]?.message ?? "Dados inválidos." };
  const p = roteiroDeep.porId.get(d.data.perguntaId);
  if (!p) return { message: "Pergunta fora do roteiro." };

  let valor = null;
  if (!d.data.naoSeAplica) {
    const v = valorDoFormulario(p, { texto: d.data.texto, opcoes: d.data.opcoes });
    if (!v.ok) return { message: v.erro.replace(`${p.id}: `, "Valor inválido: ") + "." };
    valor = v.valor;
  }

  const trace = newTraceId();
  const analista = await analistaDaSessao();
  if (!analista) return { message: SESSAO_EXPIRADA };
  const r = await deepRegistrarRespostas(d.data.sessaoId, analista, [
    { pergunta_id: p.id, area: p.area, valor, nao_se_aplica: d.data.naoSeAplica, confianca: d.data.confianca },
  ]);
  if (r.error) return erroDoBanco("deep.corrigir", trace, analista.userId, r.error);
  log("info", "deep.corrigir.ok", { trace, ator: analista.userId, sessao: d.data.sessaoId, pergunta: p.id, gravadas: r.resultado?.gravadas ?? 0 });
  revalidatePath(`/deep/${d.data.deepId}`, "layout");
  return { ok: true, message: r.resultado?.gravadas ? "Resposta gravada." : "Nada mudou: o valor é o mesmo." };
}

// ------------------------------------------------------- encerrar reunião

const encerrarSchema = z.object({
  deepId: id,
  sessaoId: id,
  resumo: z.string().trim().min(1, "Escreva o resumo da reunião.").max(20000, "Resumo até 20.000 caracteres."),
});

/** Encerra a reunião com o resumo revisado; ele vira contexto das próximas. */
export async function encerrarReuniao(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const d = encerrarSchema.safeParse({ deepId: form.get("deepId"), sessaoId: form.get("sessaoId"), resumo: form.get("resumo") ?? "" });
  if (!d.success) return { message: d.error.issues[0]?.message ?? "Dados inválidos." };
  const trace = newTraceId();
  const analista = await analistaDaSessao();
  if (!analista) return { message: SESSAO_EXPIRADA };
  const r = await deepEncerrarSessao(d.data.sessaoId, analista, d.data.resumo);
  if (r.error) return erroDoBanco("deep.reuniao_encerrar", trace, analista.userId, r.error);
  log("info", "deep.reuniao_encerrar.ok", { trace, ator: analista.userId, sessao: d.data.sessaoId, tamanho: d.data.resumo.length });
  revalidatePath(`/deep/${d.data.deepId}`, "layout");
  redirect(`/deep/${d.data.deepId}`);
}

// ------------------------------------------------------------ pendências

const pendenciaSchema = z.object({
  deepId: id,
  pendenciaId: id,
  status: z.enum(["recebida", "cancelada"]),
  nota: z.string().trim().max(1000, "Nota até 1000 caracteres."),
});

/** Fecha uma pendência (dado recebido ou pedido cancelado). */
export async function fecharPendencia(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const d = pendenciaSchema.safeParse({
    deepId: form.get("deepId"),
    pendenciaId: form.get("pendenciaId"),
    status: form.get("status"),
    nota: form.get("nota") ?? "",
  });
  if (!d.success) return { message: d.error.issues[0]?.message ?? "Dados inválidos." };
  const trace = newTraceId();
  const analista = await analistaDaSessao();
  if (!analista) return { message: SESSAO_EXPIRADA };
  const r = await deepFecharPendencia(d.data.pendenciaId, analista, d.data.status, d.data.nota || null);
  if (r.error) return erroDoBanco("deep.pendencia_fechar", trace, analista.userId, r.error);
  log("info", "deep.pendencia_fechar.ok", { trace, ator: analista.userId, pendencia: d.data.pendenciaId, status: d.data.status });
  revalidatePath(`/deep/${d.data.deepId}`, "layout");
  return { ok: true, message: d.data.status === "recebida" ? "Marcada como recebida." : "Pendência cancelada." };
}
