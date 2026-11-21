"use server";

import { z } from "zod";
import { chamarAnthropic, detalheErroApi } from "@/lib/assessment/agente/conversa";
import {
  ErroEscutaSelf,
  aplicarConfirmado,
  processarEscutaSelf,
  receberBlocosSelf,
  rotuloDoCampo,
  valorLegivel,
  type AcessoRascunho,
} from "@/lib/assessment/agente/escuta-self";
import type { Empresa06, Rascunho06 } from "@/lib/assessment/v06/questionario";
import { eFormato06, montarQuestionario06 } from "@/lib/assessment/v06/self";
import { sessaoComMfa } from "@/lib/auth/mfa";
import { getSessao } from "@/lib/auth/session";
import { agenteConfigurado, escutaConfigurada, llmEnv } from "@/lib/env";
import { ENDERECO_ESCUTA, MINUTOS_POR_TOKEN, PROTOCOLO_ESCUTA, VERSAO_CONSENTIMENTO } from "@/lib/escuta/config";
import { MAX_SEQ } from "@/lib/escuta/papeis";
import { tokenDaEscuta } from "@/lib/escuta/token";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import * as servidor from "@/lib/supabase/servidor";

/**
 * Escuta (áudio) do Self. Quem decide o acesso é o banco: cada função
 * self_escuta_* confere de novo se a pessoa pode editar o rascunho e tem
 * direito ao Self, e se a escuta está ligada com consentimento vigente.
 * Aqui só se valida a forma, se identifica a pessoa pela sessão e se registra
 * no log (nunca o texto falado).
 */

const idSchema = z.uuid();
const modoSchema = z.enum(["desligada", "pergunta", "fluido", "ambos"]);
const blocosSchema = z
  .array(
    z.object({
      seq: z.number().int().min(1).max(MAX_SEQ),
      canal: z.enum(["sala", "remoto"]),
      texto: z.string().max(4000),
    }),
  )
  .min(1)
  .max(20);

export interface ItemAConfirmar {
  id: string;
  pergunta: string;
  valor: string;
  motivo: string;
  trecho: string | null;
}

export interface EstadoEscutaTela {
  modo: "desligada" | "pergunta" | "fluido" | "ambos";
  /** ISO do fim da validade do consentimento, ou nulo. */
  validoAte: string | null;
  minutosRestantes: number;
  aConfirmar: ItemAConfirmar[];
}

export type RespostaEscuta<T = object> = ({ ok: true } & T) | { ok: false; erro: string };

const INDISPONIVEL = "O áudio está indisponível agora. A conversa por texto continua funcionando.";

async function pessoaDaSessao(): Promise<{ pessoa: servidor.PessoaSelf; supabase: Awaited<ReturnType<typeof createClient>> } | null> {
  const sessao = await getSessao();
  const userId = sessao?.perfil?.id;
  if (!userId || sessao?.perfil?.status !== "ativo") return null;
  const supabase = await createClient();
  return { pessoa: { userId, aal2: await sessaoComMfa(supabase) }, supabase };
}

/** Erro do banco em texto para a pessoa, sem detalhe interno. */
function mensagemDoBanco(codigo: string | undefined, mensagem: string | undefined, trace: string): string {
  const m = mensagem ?? "";
  if (m.includes("sem consentimento")) return "O consentimento venceu ou não foi registrado. Leia o aviso de novo para ligar o áudio.";
  if (m.includes("limite de minutos")) return "Este assessment chegou ao limite de minutos de áudio. Continue por texto.";
  if (m.includes("limite de blocos")) return "Este assessment chegou ao limite de transcrição. Continue por texto.";
  if (m.includes("desligada")) return "O áudio está desligado.";
  if (codigo === "42501" || m.includes("sem acesso")) return "Você não pode usar o áudio neste assessment.";
  return `Não foi possível concluir agora. (código ${trace})`;
}

function lerItens(bruto: unknown): { id: string; pergunta_id: string; valor: unknown; motivo: string; trecho: string | null }[] {
  if (bruto === null || typeof bruto !== "object") return [];
  const lista = (bruto as { a_confirmar?: unknown }).a_confirmar;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((i) => {
    const o = i as Record<string, unknown>;
    return typeof o?.id === "string" && typeof o.pergunta_id === "string" && typeof o.motivo === "string"
      ? [{ id: o.id, pergunta_id: o.pergunta_id, valor: o.valor, motivo: o.motivo, trecho: typeof o.trecho === "string" ? o.trecho : null }]
      : [];
  });
}

function paraTela(bruto: unknown): EstadoEscutaTela {
  const q = montarQuestionario06();
  const o = (bruto ?? {}) as Record<string, unknown>;
  const modo = modoSchema.safeParse(o.modo);
  return {
    modo: modo.success ? modo.data : "desligada",
    validoAte: typeof o.consentimento_valido_ate === "string" ? o.consentimento_valido_ate : null,
    minutosRestantes: typeof o.minutos_restantes === "number" ? o.minutos_restantes : 0,
    aConfirmar: lerItens(bruto).map((i) => ({
      id: i.id,
      pergunta: rotuloDoCampo(q, i.pergunta_id),
      valor: valorLegivel(q, i.pergunta_id, i.valor),
      motivo: i.motivo,
      trecho: i.trecho,
    })),
  };
}

/** Rascunho lido e gravado com a sessão da pessoa (RLS), com controle de versão. */
function acessoRascunho(supabase: Awaited<ReturnType<typeof createClient>>, id: string): AcessoRascunho {
  return {
    async ler() {
      const { data } = await supabase
        .from("assessments")
        .select("setor, status, respostas, empresa, atualizado_em")
        .eq("id", id)
        .maybeSingle<{ setor: string; status: string; respostas: unknown; empresa: Empresa06 | null; atualizado_em: string }>();
      return data ?? null;
    },
    async gravar(respostas, versao) {
      const { data, error } = await supabase
        .from("assessments")
        .update({ respostas })
        .eq("id", id)
        .eq("status", "rascunho")
        .eq("atualizado_em", versao)
        .select("atualizado_em")
        .maybeSingle<{ atualizado_em: string }>();
      if (error) throw new ErroEscutaSelf("rascunho", error.code);
      return data?.atualizado_em ?? null;
    },
  };
}

/** Estado da escuta para a tela (modo, validade, minutos e lista a confirmar). */
export async function lerEscuta(id: string): Promise<RespostaEscuta<{ estado: EstadoEscutaTela; disponivel: boolean }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const ctx = await pessoaDaSessao();
  if (!ctx) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const trace = newTraceId();
  const r = await servidor.selfEscutaEstado(id, ctx.pessoa);
  if (r.error) {
    log("info", "self.escuta.estado_recusado", { trace, ator: ctx.pessoa.userId, code: r.error.code });
    return { ok: false, erro: mensagemDoBanco(r.error.code, r.error.message, trace) };
  }
  return { ok: true, estado: paraTela(r.estado), disponivel: escutaConfigurada() && agenteConfigurado() };
}

/** Registra que o texto foi lido e aceito pelas pessoas presentes. */
export async function consentirEscuta(id: string, pessoas: number): Promise<RespostaEscuta<{ estado: EstadoEscutaTela }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const n = z.number().int().min(1).max(30).safeParse(pessoas);
  if (!n.success) return { ok: false, erro: "Informe quantas pessoas estão na reunião (1 a 30)." };
  const ctx = await pessoaDaSessao();
  if (!ctx) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const trace = newTraceId();
  const r = await servidor.selfEscutaConsentir(id, ctx.pessoa, VERSAO_CONSENTIMENTO, n.data);
  if (r.error) {
    log("warn", "self.escuta.consentimento_recusado", { trace, ator: ctx.pessoa.userId, code: r.error.code });
    return { ok: false, erro: mensagemDoBanco(r.error.code, r.error.message, trace) };
  }
  log("info", "self.escuta.consentimento", { trace, ator: ctx.pessoa.userId, pessoas: n.data });
  const e = await servidor.selfEscutaEstado(id, ctx.pessoa);
  return { ok: true, estado: paraTela(e.estado) };
}

/** Liga, troca ou desliga o modo. */
export async function definirModoEscuta(id: string, modo: string): Promise<RespostaEscuta<{ estado: EstadoEscutaTela }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const m = modoSchema.safeParse(modo);
  if (!m.success) return { ok: false, erro: "Modo inválido." };
  const ctx = await pessoaDaSessao();
  if (!ctx) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const trace = newTraceId();
  if (m.data !== "desligada" && !(escutaConfigurada() && agenteConfigurado())) {
    log("error", "self.escuta.sem_config", { trace });
    return { ok: false, erro: INDISPONIVEL };
  }
  const r = await servidor.selfEscutaDefinir(id, ctx.pessoa, m.data);
  if (r.error) {
    log("warn", "self.escuta.modo_recusado", { trace, ator: ctx.pessoa.userId, code: r.error.code });
    return { ok: false, erro: mensagemDoBanco(r.error.code, r.error.message, trace) };
  }
  log("info", "self.escuta.modo", { trace, ator: ctx.pessoa.userId, modo: m.data });
  const e = await servidor.selfEscutaEstado(id, ctx.pessoa);
  return { ok: true, estado: paraTela(e.estado) };
}

/**
 * Token curto para abrir ou renovar a escuta. Antes, reserva no banco os
 * minutos que o token cobre: sem minutos, sem token.
 */
export async function tokenEscuta(id: string): Promise<RespostaEscuta<{ token: string; exp: number; endereco: string; protocolo: string; minutosRestantes: number }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const ctx = await pessoaDaSessao();
  if (!ctx) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const trace = newTraceId();
  if (!escutaConfigurada()) {
    log("error", "self.escuta.sem_config", { trace });
    return { ok: false, erro: INDISPONIVEL };
  }
  const r = await servidor.selfEscutaReservarMinutos(id, ctx.pessoa, MINUTOS_POR_TOKEN);
  if (r.error || r.restantes === null) {
    log("warn", "self.escuta.token_recusado", { trace, ator: ctx.pessoa.userId, code: r.error?.code ?? "sem_resultado" });
    return { ok: false, erro: mensagemDoBanco(r.error?.code, r.error?.message, trace) };
  }
  const t = await tokenDaEscuta(id, ctx.pessoa.userId);
  log("info", "self.escuta.token", { trace, ator: ctx.pessoa.userId, restantes: r.restantes });
  return { ok: true, token: t.token, exp: t.exp, endereco: ENDERECO_ESCUTA, protocolo: PROTOCOLO_ESCUTA, minutosRestantes: r.restantes };
}

/** Guarda blocos transcritos (modo fluido e ambos). O servidor mascara antes de gravar. */
export async function enviarBlocosEscuta(id: string, blocos: unknown): Promise<RespostaEscuta<{ gravados: number }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const b = blocosSchema.safeParse(blocos);
  if (!b.success) return { ok: false, erro: "Blocos inválidos." };
  const ctx = await pessoaDaSessao();
  if (!ctx) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const trace = newTraceId();
  try {
    const r = await receberBlocosSelf({ assessmentId: id, pessoa: ctx.pessoa, blocos: b.data });
    log("info", "self.escuta.blocos", { trace, ator: ctx.pessoa.userId, gravados: r.gravados, repetidos: r.repetidos, descartados: r.descartados, ...r.mascarados });
    return { ok: true, gravados: r.gravados };
  } catch (err) {
    const codigo = err instanceof ErroEscutaSelf ? err.codigo : "desconhecido";
    log("warn", "self.escuta.blocos_recusados", { trace, ator: ctx.pessoa.userId, codigo });
    return { ok: false, erro: `Não foi possível guardar a transcrição. (código ${trace})` };
  }
}

/**
 * Leva os blocos pendentes ao agente. A tela chama uma vez por vez (nunca
 * duas ao mesmo tempo) e repete enquanto houver blocos restantes.
 */
export async function processarEscuta(
  id: string,
): Promise<RespostaEscuta<{ restantes: boolean; processados: number; respostas?: Rascunho06; versao?: string; estado: EstadoEscutaTela }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Assessment inválido." };
  const ctx = await pessoaDaSessao();
  if (!ctx) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const trace = newTraceId();
  if (!agenteConfigurado()) return { ok: false, erro: INDISPONIVEL };
  const inicio = Date.now();
  try {
    const r = await processarEscutaSelf({
      assessmentId: id,
      pessoa: ctx.pessoa,
      chamar: chamarAnthropic(llmEnv().ANTHROPIC_API_KEY),
      rascunho: acessoRascunho(ctx.supabase, id),
    });
    log("info", "self.escuta.lote", {
      trace,
      ator: ctx.pessoa.userId,
      processados: r.processados,
      restantes: r.restantes,
      propostas: r.propostas,
      gravou: Boolean(r.versao),
      fim: r.turno?.fim ?? "sem_turno",
      ms: Date.now() - inicio,
      tokens_entrada: r.turno?.uso.entrada ?? 0,
      tokens_saida: r.turno?.uso.saida ?? 0,
      cache_leitura: r.turno?.uso.cacheLeitura ?? 0,
    });
    const e = await servidor.selfEscutaEstado(id, ctx.pessoa);
    return {
      ok: true,
      restantes: r.restantes,
      processados: r.processados,
      estado: paraTela(e.estado),
      ...(r.versao && r.respostas ? { versao: r.versao, respostas: r.respostas } : {}),
    };
  } catch (err) {
    if (err instanceof ErroEscutaSelf) {
      log("warn", "self.escuta.lote_falhou", { trace, ator: ctx.pessoa.userId, etapa: err.etapa, codigo: err.codigo });
      if (err.etapa === "conflito") return { ok: false, erro: "Alguém salvou o assessment agora. A escuta tenta de novo em instantes." };
      if (err.etapa === "formato") return { ok: false, erro: "Este rascunho é de uma versão antiga do Self e não aceita o áudio." };
      return { ok: false, erro: `Não foi possível analisar a transcrição agora. (código ${trace})` };
    }
    log("error", "self.escuta.llm_erro", { trace, ator: ctx.pessoa.userId, ...detalheErroApi(err) });
    return { ok: false, erro: `O assistente não respondeu agora; a transcrição fica guardada e é analisada depois. (código ${trace})` };
  }
}

/**
 * Confirma ou descarta uma resposta ouvida com dúvida. Confirmar grava no
 * rascunho (mesma validação do formulário, com controle de versão), registra
 * a origem "escuta_confirmada" e só então fecha o item.
 */
export async function resolverEscuta(
  id: string,
  itemId: string,
  decisao: string,
): Promise<RespostaEscuta<{ estado: EstadoEscutaTela; respostas?: Rascunho06; versao?: string }>> {
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(itemId).success) return { ok: false, erro: "Item inválido." };
  const d = z.enum(["confirmar", "descartar"]).safeParse(decisao);
  if (!d.success) return { ok: false, erro: "Decisão inválida." };
  const ctx = await pessoaDaSessao();
  if (!ctx) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  const trace = newTraceId();

  let gravado: { versao: string; respostas: Rascunho06 } | undefined;
  if (d.data === "confirmar") {
    const e = await servidor.selfEscutaEstado(id, ctx.pessoa);
    if (e.error) return { ok: false, erro: mensagemDoBanco(e.error.code, e.error.message, trace) };
    const item = lerItens(e.estado).find((i) => i.id === itemId);
    if (!item) return { ok: false, erro: "Este item já foi resolvido." };
    const acesso = acessoRascunho(ctx.supabase, id);
    const linha = await acesso.ler();
    if (!linha || linha.status !== "rascunho" || !eFormato06(linha.respostas)) return { ok: false, erro: "O rascunho não aceita esta resposta." };
    const q = montarQuestionario06();
    const a = aplicarConfirmado(q, { setor: linha.setor, respostas: (linha.respostas ?? {}) as Rascunho06, empresa: linha.empresa ?? {} }, item.pergunta_id, item.valor);
    if (!a.ok) {
      log("warn", "self.escuta.confirmar_invalido", { trace, ator: ctx.pessoa.userId });
      return { ok: false, erro: "Este valor não é aceito pelo Self. Descarte e responda pela conversa." };
    }
    let versao: string | null;
    try {
      versao = await acesso.gravar(a.respostas, linha.atualizado_em);
    } catch {
      versao = null;
    }
    if (!versao) return { ok: false, erro: "Alguém salvou o assessment agora. Tente confirmar de novo." };
    const o = await servidor.selfEscutaRegistrarOrigem(id, ctx.pessoa, [{ pergunta_id: item.pergunta_id, valor: a.gravado }], "escuta_confirmada");
    if (o.error) log("warn", "self.escuta.origem_falhou", { trace, ator: ctx.pessoa.userId, code: o.error.code });
    gravado = { versao, respostas: a.respostas };
  }

  const r = await servidor.selfEscutaResolver(itemId, d.data, ctx.pessoa);
  if (r.error) {
    log("warn", "self.escuta.resolver_recusado", { trace, ator: ctx.pessoa.userId, code: r.error.code });
    return { ok: false, erro: mensagemDoBanco(r.error.code, r.error.message, trace) };
  }
  log("info", "self.escuta.resolvido", { trace, ator: ctx.pessoa.userId, decisao: d.data });
  const e = await servidor.selfEscutaEstado(id, ctx.pessoa);
  return { ok: true, estado: paraTela(e.estado), ...(gravado ?? {}) };
}
