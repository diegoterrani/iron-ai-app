import "server-only";
import { createClient } from "@supabase/supabase-js";
import { adminEnv, publicEnv } from "@/lib/env";

/**
 * Operações que só o servidor executa no banco (papel service_role).
 * Expõe UMA função por operação, nunca o cliente: assim ninguém usa a chave
 * secreta para ler ou gravar tabelas por fora do RLS.
 *
 * Regra: só chame depois de autorizar com a sessão do usuário (RLS e
 * tem_direito), como em src/app/(app)/assessment/actions.ts.
 */
function clienteServidor() {
  const { NEXT_PUBLIC_SUPABASE_URL } = publicEnv();
  const { SUPABASE_SECRET_KEY } = adminEnv();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface ConclusaoSelf {
  assessmentId: string;
  userId: string;
  hash: string;
  respostas: unknown;
  versoes: { motor: string; modelo: string; pacote: string };
  resultado: unknown;
  /** Sessão de quem pediu está em aal2 (MFA). O banco usa para papéis de staff. */
  aal2: boolean;
}

/** Grava o resultado calculado pelo motor e fecha o rascunho (concluir_self no banco). */
export async function gravarConclusaoSelf(c: ConclusaoSelf) {
  const { data, error } = await clienteServidor().rpc("concluir_self", {
    p_assessment: c.assessmentId,
    p_user: c.userId,
    p_hash: c.hash,
    p_respostas: c.respostas,
    p_motor: c.versoes.motor,
    p_modelo: c.versoes.modelo,
    p_pacote: c.versoes.pacote,
    p_resultado: c.resultado,
    p_aal2: c.aal2,
  });
  return { data: data as number | null, error: error ? { code: error.code, message: error.message } : null };
}

export interface UsoConversa {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

/**
 * Reserva um turno da conversa da pessoa antes de chamar o LLM (teto de 60 no
 * banco) e devolve o histórico dela. O banco confere rascunho, conta ativa e
 * se a pessoa pode editar (dono do pessoal ou assessment.editar na empresa).
 */
export async function reservarTurnoConversa(assessmentId: string, userId: string, aal2: boolean) {
  const { data, error } = await clienteServidor().rpc("conversa_reservar_turno", {
    p_assessment: assessmentId,
    p_user: userId,
    p_aal2: aal2,
  });
  return { historico: (data ?? []) as unknown[], error: error ? { code: error.code, message: error.message } : null };
}

/** Grava o histórico (só cresce) e soma o uso de tokens do turno. */
export async function gravarConversa(assessmentId: string, userId: string, historico: unknown[], uso: UsoConversa) {
  const { error } = await clienteServidor().rpc("conversa_gravar", {
    p_assessment: assessmentId,
    p_user: userId,
    p_mensagens: historico,
    p_tokens_entrada: uso.entrada,
    p_tokens_saida: uso.saida,
    p_tokens_cache_leitura: uso.cacheLeitura,
    p_tokens_cache_escrita: uso.cacheEscrita,
  });
  return { error: error ? { code: error.code, message: error.message } : null };
}

// ------------------------------------------------------------ Deep assessment
// Funções deep_* da migração 20261120120000: todas recebem o analista e o MFA
// da sessão, e o banco confere deep.conduzir de novo.

export interface ErroBanco {
  code: string;
  message: string;
}
const erroBanco = (error: { code: string; message: string } | null): ErroBanco | null =>
  error ? { code: error.code, message: error.message } : null;

export interface AnalistaDeep {
  userId: string;
  aal2: boolean;
}

/** Reserva um turno da reunião (tetos no banco) e devolve as falas dela. */
export async function deepReservarTurno(sessaoId: string, a: AnalistaDeep) {
  const { data, error } = await clienteServidor().rpc("deep_reservar_turno", { p_sessao: sessaoId, p_user: a.userId, p_aal2: a.aal2 });
  return { falas: (data ?? []) as unknown[], error: erroBanco(error) };
}

/** Estado do Deep para o agente: resumos das reuniões, respostas, evidências e pendências. */
export async function deepEstado(deepId: string, a: AnalistaDeep) {
  const { data, error } = await clienteServidor().rpc("deep_estado", { p_deep: deepId, p_user: a.userId, p_aal2: a.aal2 });
  return { estado: data as unknown, error: erroBanco(error) };
}

/** Acrescenta as falas do turno à reunião e soma o uso de tokens. */
export async function deepGravarMensagens(sessaoId: string, a: AnalistaDeep, falas: unknown[], uso: UsoConversa) {
  const { data, error } = await clienteServidor().rpc("deep_gravar_mensagens", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_mensagens: falas,
    p_tokens_entrada: uso.entrada,
    p_tokens_saida: uso.saida,
    p_tokens_cache_leitura: uso.cacheLeitura,
    p_tokens_cache_escrita: uso.cacheEscrita,
  });
  return { ultimaOrdem: data as number | null, error: erroBanco(error) };
}

export async function deepRegistrarRespostas(sessaoId: string, a: AnalistaDeep, respostas: unknown[]) {
  const { data, error } = await clienteServidor().rpc("deep_registrar_respostas", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_respostas: respostas,
  });
  return { resultado: data as { gravadas: number; inalteradas: number } | null, error: erroBanco(error) };
}

/** Como deep_registrar_respostas, mas com a origem decidida aqui (migração 20261120200000): "escuta" vem do agente ouvinte. */
export async function deepRegistrarRespostasOrigem(sessaoId: string, a: AnalistaDeep, respostas: unknown[], origem: "digitacao" | "escuta") {
  const { data, error } = await clienteServidor().rpc("deep_registrar_respostas_origem", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_respostas: respostas,
    p_origem: origem,
  });
  return { resultado: data as { gravadas: number; inalteradas: number } | null, error: erroBanco(error) };
}

// Escuta da reunião (migração 20261120200000).

/** Guarda blocos transcritos (até 20); bloco repetido (mesmo seq) é ignorado. */
export async function deepEscutaGravarBlocos(
  sessaoId: string,
  a: AnalistaDeep,
  blocos: { seq: number; canal: "sala" | "remoto"; texto: string; inicio_ms?: number; fim_ms?: number }[],
) {
  const { data, error } = await clienteServidor().rpc("deep_escuta_gravar_blocos", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_blocos: blocos,
  });
  return { resultado: data as { gravados: number; repetidos: number } | null, error: erroBanco(error) };
}

/** Blocos ainda não processados pelo agente, em ordem (até 40). */
export async function deepEscutaPendentes(sessaoId: string, a: AnalistaDeep) {
  const { data, error } = await clienteServidor().rpc("deep_escuta_pendentes", { p_sessao: sessaoId, p_user: a.userId, p_aal2: a.aal2 });
  return { blocos: (data ?? []) as unknown[], error: erroBanco(error) };
}

/** Marca os blocos que o turno do agente recebeu; p_mensagem_ordem é a fala do analista desse turno. */
export async function deepEscutaMarcarProcessados(sessaoId: string, a: AnalistaDeep, seqs: number[], mensagemOrdem: number) {
  const { data, error } = await clienteServidor().rpc("deep_escuta_marcar_processados", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_seqs: seqs,
    p_mensagem_ordem: mensagemOrdem,
  });
  return { marcados: data as number | null, error: erroBanco(error) };
}

/** Respostas ouvidas com pouca certeza: ficam "a confirmar" e não entram no Deep. */
export async function deepEscutaPropor(sessaoId: string, a: AnalistaDeep, itens: unknown[]) {
  const { data, error } = await clienteServidor().rpc("deep_escuta_propor", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_itens: itens,
  });
  return { guardadas: data as number | null, error: erroBanco(error) };
}

export async function deepRegistrarEvidencias(sessaoId: string, a: AnalistaDeep, evidencias: unknown[]) {
  const { data, error } = await clienteServidor().rpc("deep_registrar_evidencias", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_evidencias: evidencias,
  });
  return { resultado: data as { gravadas: number; inalteradas: number } | null, error: erroBanco(error) };
}

export async function deepRegistrarPendencia(
  sessaoId: string,
  a: AnalistaDeep,
  p: { fonte?: string; descricao: string; responsavel?: string; prazo?: string },
) {
  const { data, error } = await clienteServidor().rpc("deep_registrar_pendencia", {
    p_sessao: sessaoId,
    p_user: a.userId,
    p_aal2: a.aal2,
    p_fonte: p.fonte ?? null,
    p_descricao: p.descricao,
    p_responsavel: p.responsavel ?? null,
    p_prazo: p.prazo ?? null,
  });
  return { id: data as string | null, error: erroBanco(error) };
}

/** Abre o Deep da empresa ou devolve o que já está em andamento. */
export async function deepAbrir(
  a: AnalistaDeep,
  d: { orgId: string; setor: string; pacoteVersao: string; selfAssessmentId: string | null },
) {
  const { data, error } = await clienteServidor().rpc("deep_abrir", {
    p_org: d.orgId,
    p_setor: d.setor,
    p_pacote_versao: d.pacoteVersao,
    p_escopo: {},
    p_self_assessment: d.selfAssessmentId,
    p_user: a.userId,
    p_aal2: a.aal2,
  });
  return { id: data as string | null, error: erroBanco(error) };
}

/** Começa uma reunião da área (ou devolve a que já está aberta). */
export async function deepAbrirSessao(
  deepId: string,
  a: AnalistaDeep,
  s: { area: string; titulo: string; participantes: { nome: string; cargo?: string }[] },
) {
  const { data, error } = await clienteServidor().rpc("deep_abrir_sessao", {
    p_deep: deepId,
    p_area: s.area,
    p_titulo: s.titulo,
    p_participantes: s.participantes,
    p_user: a.userId,
    p_aal2: a.aal2,
  });
  return { id: data as string | null, error: erroBanco(error) };
}

/** Encerra a reunião com o resumo revisado pelo analista. */
export async function deepEncerrarSessao(sessaoId: string, a: AnalistaDeep, resumo: string) {
  const { error } = await clienteServidor().rpc("deep_encerrar_sessao", {
    p_sessao: sessaoId,
    p_resumo: resumo,
    p_user: a.userId,
    p_aal2: a.aal2,
  });
  return { error: erroBanco(error) };
}

/** Marca uma pendência como recebida ou cancelada. */
export async function deepFecharPendencia(pendenciaId: string, a: AnalistaDeep, status: "recebida" | "cancelada", nota: string | null) {
  const { error } = await clienteServidor().rpc("deep_fechar_pendencia", {
    p_pendencia: pendenciaId,
    p_status: status,
    p_nota: nota,
    p_user: a.userId,
    p_aal2: a.aal2,
  });
  return { error: erroBanco(error) };
}

// ------------------------------------------------------------ escuta no Self

/** Quem pediu, como a sessão mostra: o banco confere de novo se pode editar e tem direito ao Self. */
export interface PessoaSelf {
  userId: string;
  aal2: boolean;
}

/** Modo, validade do consentimento, minutos restantes e itens a confirmar da pessoa. */
export async function selfEscutaEstado(assessmentId: string, p: PessoaSelf) {
  const { data, error } = await clienteServidor().rpc("self_escuta_estado", { p_assessment: assessmentId, p_user: p.userId, p_aal2: p.aal2 });
  return { estado: data as unknown, error: erroBanco(error) };
}

/** Grava até 20 blocos transcritos (modo fluido ou ambos); repetidos são ignorados. */
export async function selfEscutaGravarBlocos(
  assessmentId: string,
  p: PessoaSelf,
  blocos: { seq: number; canal: "sala" | "remoto"; texto: string; inicio_ms?: number; fim_ms?: number }[],
) {
  const { data, error } = await clienteServidor().rpc("self_escuta_gravar_blocos", {
    p_assessment: assessmentId,
    p_user: p.userId,
    p_aal2: p.aal2,
    p_blocos: blocos,
  });
  return { resultado: data as { gravados: number; repetidos: number } | null, error: erroBanco(error) };
}

/** Blocos ainda não processados, em ordem (até 40). */
export async function selfEscutaPendentes(assessmentId: string, p: PessoaSelf) {
  const { data, error } = await clienteServidor().rpc("self_escuta_pendentes", { p_assessment: assessmentId, p_user: p.userId, p_aal2: p.aal2 });
  return { blocos: (data ?? []) as unknown[], error: erroBanco(error) };
}

export async function selfEscutaMarcarProcessados(assessmentId: string, p: PessoaSelf, seqs: number[]) {
  const { data, error } = await clienteServidor().rpc("self_escuta_marcar_processados", {
    p_assessment: assessmentId,
    p_user: p.userId,
    p_aal2: p.aal2,
    p_seqs: seqs,
  });
  return { marcados: data as number | null, error: erroBanco(error) };
}

/** Registra que estes campos do rascunho foram gravados pela escuta, com o valor gravado. */
export async function selfEscutaRegistrarOrigem(
  assessmentId: string,
  p: PessoaSelf,
  itens: { pergunta_id: string; valor: unknown }[],
  origem: "escuta" | "escuta_confirmada",
) {
  const { data, error } = await clienteServidor().rpc("self_escuta_registrar_origem", {
    p_assessment: assessmentId,
    p_user: p.userId,
    p_aal2: p.aal2,
    p_itens: itens,
    p_origem: origem,
  });
  return { registrados: data as number | null, error: erroBanco(error) };
}

/** Respostas ouvidas com pouca certeza: ficam "a confirmar" e não entram no rascunho. */
export async function selfEscutaPropor(
  assessmentId: string,
  p: PessoaSelf,
  itens: { pergunta_id: string; valor: unknown; motivo: string; trecho: string }[],
) {
  const { data, error } = await clienteServidor().rpc("self_escuta_propor", {
    p_assessment: assessmentId,
    p_user: p.userId,
    p_aal2: p.aal2,
    p_itens: itens,
  });
  return { guardadas: data as number | null, error: erroBanco(error) };
}

/** Registra o consentimento (versão do texto lido e quantas pessoas estavam presentes). */
export async function selfEscutaConsentir(assessmentId: string, p: PessoaSelf, textoVersao: string, pessoas: number) {
  const { error } = await clienteServidor().rpc("self_escuta_consentir", {
    p_assessment: assessmentId,
    p_user: p.userId,
    p_aal2: p.aal2,
    p_texto_versao: textoVersao,
    p_pessoas: pessoas,
  });
  return { error: erroBanco(error) };
}

/** Liga, troca ou desliga a escuta (ligar exige consentimento vigente; o banco confere). */
export async function selfEscutaDefinir(assessmentId: string, p: PessoaSelf, modo: "desligada" | "pergunta" | "fluido" | "ambos") {
  const { error } = await clienteServidor().rpc("self_escuta_definir", {
    p_assessment: assessmentId,
    p_user: p.userId,
    p_aal2: p.aal2,
    p_modo: modo,
  });
  return { error: erroBanco(error) };
}

/** Reserva minutos de áudio antes de emitir o token de transcrição; devolve os minutos que restam. */
export async function selfEscutaReservarMinutos(assessmentId: string, p: PessoaSelf, minutos: number) {
  const { data, error } = await clienteServidor().rpc("self_escuta_reservar_minutos", {
    p_assessment: assessmentId,
    p_user: p.userId,
    p_aal2: p.aal2,
    p_minutos: minutos,
  });
  return { restantes: data as number | null, error: erroBanco(error) };
}

/** Fecha um item a confirmar (só quem ligou a escuta). */
export async function selfEscutaResolver(itemId: string, decisao: "confirmar" | "descartar", p: PessoaSelf) {
  const { data, error } = await clienteServidor().rpc("self_escuta_resolver", {
    p_item: itemId,
    p_decisao: decisao,
    p_user: p.userId,
    p_aal2: p.aal2,
  });
  return { resultado: data as { assessment_id: string; pergunta_id: string; valor: unknown } | null, error: erroBanco(error) };
}
