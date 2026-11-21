import "server-only";
import type { ChamarLLM } from "@/lib/assessment/agente/conversa";
import { roteiroDeep, type AreaDeep, type RoteiroDeep } from "@/lib/assessment/deep/roteiro";
import * as servidor from "@/lib/supabase/servidor";
import { blocoContexto, estadoParaModelo, type EstadoBanco } from "./contexto";
import {
  JANELA_TURNOS_ESCUTA,
  escolherLote,
  montarTextoEscuta,
  prepararBlocos,
  type BlocoEscuta,
  type BlocoRecebido,
  type ModoEscuta,
} from "./escuta";
import type { BancoDeep } from "./ferramentas";
import type { TipoMascara } from "./mascara";
import { executarTurnoDeep, type FalaDeep, type ResultadoTurnoDeep } from "./turno";

/**
 * Uma fala do analista numa reunião do Deep, de ponta a ponta:
 * 1. reserva o turno no banco (teto de custo) e lê as falas da reunião;
 * 2. lê o estado do Deep e monta o contexto (resumos + estado + falas);
 * 3. roda o agente, que grava respostas, evidências e pendências pelas
 *    funções do banco;
 * 4. acrescenta as falas do turno à reunião, com o uso de tokens.
 *
 * Quem chama (a Server Action da tela, PR 4) já conferiu a sessão do
 * analista; o banco confere deep.conduzir e o MFA de novo em cada passo.
 */

export class ErroReuniao extends Error {
  constructor(
    readonly etapa: "reservar" | "estado" | "gravar" | "ferramenta" | "escuta",
    readonly codigo: string,
  ) {
    super(`falha ao ${etapa} (${codigo})`);
  }
}

/** Acesso ao banco usado aqui; nos testes, uma versão em memória. */
export type ServidorDeep = Pick<
  typeof servidor,
  "deepReservarTurno" | "deepEstado" | "deepGravarMensagens" | "deepRegistrarRespostas" | "deepRegistrarEvidencias" | "deepRegistrarPendencia"
>;

/** O que a escuta usa além do Deep: receber e processar blocos, e guardar o que fica a confirmar. */
export type ServidorEscuta = ServidorDeep &
  Pick<
    typeof servidor,
    "deepRegistrarRespostasOrigem" | "deepEscutaGravarBlocos" | "deepEscutaPendentes" | "deepEscutaMarcarProcessados" | "deepEscutaPropor"
  >;

function bancoDaReuniao(
  srv: ServidorDeep,
  roteiro: RoteiroDeep,
  deepId: string,
  sessaoId: string,
  analista: servidor.AnalistaDeep,
  /** Presente só em turno de escuta: as respostas gravadas levam origem "escuta" e a escuta pode propor a confirmar. */
  escuta?: ServidorEscuta,
): BancoDeep {
  const lerEstado = async () => {
    const r = await srv.deepEstado(deepId, analista);
    if (r.error) throw new ErroReuniao("estado", r.error.code);
    return r.estado as EstadoBanco;
  };
  return {
    async registrarRespostas(itens) {
      const r = escuta
        ? await escuta.deepRegistrarRespostasOrigem(sessaoId, analista, itens, "escuta")
        : await srv.deepRegistrarRespostas(sessaoId, analista, itens);
      if (r.error || !r.resultado) throw new ErroReuniao("ferramenta", r.error?.code ?? "sem_resultado");
      return r.resultado;
    },
    async proporAConfirmar(itens) {
      if (!escuta) throw new ErroReuniao("ferramenta", "fora_da_escuta");
      const r = await escuta.deepEscutaPropor(sessaoId, analista, itens);
      if (r.error || r.guardadas === null) throw new ErroReuniao("ferramenta", r.error?.code ?? "sem_resultado");
      return r.guardadas;
    },
    async registrarEvidencias(itens) {
      const r = await srv.deepRegistrarEvidencias(sessaoId, analista, itens);
      if (r.error || !r.resultado) throw new ErroReuniao("ferramenta", r.error?.code ?? "sem_resultado");
      return r.resultado;
    },
    async registrarPendencia(p) {
      const r = await srv.deepRegistrarPendencia(sessaoId, analista, p);
      if (r.error || !r.id) throw new ErroReuniao("ferramenta", r.error?.code ?? "sem_resultado");
      return r.id;
    },
    async verEstado() {
      return estadoParaModelo(roteiro, await lerEstado(), sessaoId);
    },
  };
}

export async function turnoDaReuniao(args: {
  deepId: string;
  sessaoId: string;
  analista: servidor.AnalistaDeep;
  texto: string;
  chamar: ChamarLLM;
  srv?: ServidorDeep;
  roteiro?: RoteiroDeep;
}): Promise<ResultadoTurnoDeep> {
  const srv = args.srv ?? servidor;
  const roteiro = args.roteiro ?? roteiroDeep;

  const reserva = await srv.deepReservarTurno(args.sessaoId, args.analista);
  if (reserva.error) throw new ErroReuniao("reservar", reserva.error.code);

  const lido = await srv.deepEstado(args.deepId, args.analista);
  if (lido.error) throw new ErroReuniao("estado", lido.error.code);
  const estado = lido.estado as EstadoBanco;
  if (estado.deep.pacote_versao !== roteiro.pacoteVersao) {
    // Deep aberto com outro roteiro: as perguntas não batem com as gravadas.
    throw new ErroReuniao("estado", "pacote_diferente");
  }
  const sessao = estado.sessoes.find((s) => s.id === args.sessaoId);
  if (!sessao) throw new ErroReuniao("estado", "sessao_de_outro_deep");

  const resultado = await executarTurnoDeep({
    roteiro,
    area: sessao.area as AreaDeep,
    falas: reserva.falas as FalaDeep[],
    entrada: args.texto,
    contexto: blocoContexto(roteiro, estado, args.sessaoId),
    banco: bancoDaReuniao(srv, roteiro, args.deepId, args.sessaoId, args.analista),
    chamar: args.chamar,
    // Reunião com escuta junta muitos turnos: só os recentes vão ao modelo.
    janelaTurnos: reuniaoComEscuta(sessao) ? JANELA_TURNOS_ESCUTA : undefined,
  });

  const gravado = await srv.deepGravarMensagens(args.sessaoId, args.analista, resultado.novas, resultado.uso);
  if (gravado.error) throw new ErroReuniao("gravar", gravado.error.code);
  return resultado;
}

const reuniaoComEscuta = (s: EstadoBanco["sessoes"][number]) => !!s.escuta_modo && s.escuta_modo !== "desligada";

// ------------------------------------------------------------------ escuta

export type { BlocoRecebido };

const POR_CHAMADA = 20;

/**
 * Guarda blocos transcritos. O texto é mascarado aqui, antes do banco: CPF,
 * CNPJ, cartão e dados bancários ditos em voz alta não são gravados.
 * Reenviar o mesmo bloco (mesmo seq) é seguro: o banco ignora o repetido.
 */
export async function receberBlocosEscuta(args: {
  sessaoId: string;
  analista: servidor.AnalistaDeep;
  blocos: readonly BlocoRecebido[];
  srv?: Pick<ServidorEscuta, "deepEscutaGravarBlocos">;
}): Promise<{ gravados: number; repetidos: number; descartados: number; mascarados: Record<TipoMascara, number> }> {
  const srv = args.srv ?? servidor;
  const { prontos, descartados, mascarados } = prepararBlocos(args.blocos);
  let gravados = 0;
  let repetidos = 0;
  for (let i = 0; i < prontos.length; i += POR_CHAMADA) {
    const r = await srv.deepEscutaGravarBlocos(args.sessaoId, args.analista, prontos.slice(i, i + POR_CHAMADA));
    if (r.error || !r.resultado) throw new ErroReuniao("escuta", r.error?.code ?? "sem_resultado");
    gravados += r.resultado.gravados;
    repetidos += r.resultado.repetidos;
  }
  return { gravados, repetidos, descartados, mascarados };
}

/** Lê o bloco devolvido pelo banco com cuidado: o que não tem a forma esperada é ignorado. */
function lerBloco(x: unknown): BlocoEscuta | null {
  if (x === null || typeof x !== "object") return null;
  const b = x as Record<string, unknown>;
  if (typeof b.seq !== "number" || !Number.isInteger(b.seq) || typeof b.texto !== "string") return null;
  if (b.canal !== "sala" && b.canal !== "remoto") return null;
  return {
    seq: b.seq,
    canal: b.canal,
    texto: b.texto,
    pergunta_marcada: typeof b.pergunta_marcada === "string" ? b.pergunta_marcada : null,
    inicio_ms: typeof b.inicio_ms === "number" ? b.inicio_ms : null,
    fim_ms: typeof b.fim_ms === "number" ? b.fim_ms : null,
  };
}

export interface ResultadoEscuta {
  /** Blocos marcados como processados neste turno. */
  processados: number;
  /** Turno do agente; nulo quando nada foi ao modelo (sem pendentes, escuta desligada ou nenhum trecho com pergunta marcada). */
  turno: ResultadoTurnoDeep | null;
  /** Ainda há blocos para outro turno. */
  restantes: boolean;
  modo: "desligada" | ModoEscuta | null;
}

const SEM_USO = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };

/**
 * Leva um lote de blocos pendentes ao agente, como um turno de escuta.
 *
 * - Escuta desligada: nada é processado (os blocos continuam guardados).
 * - Modo pergunta a pergunta sem nenhuma pergunta marcada no lote: o modelo
 *   não é chamado (não haveria o que registrar) e o lote é marcado como visto.
 * - Se o turno falhar, nada é marcado: os blocos voltam na próxima chamada.
 *   Repetir é seguro, porque resposta igual à vigente é ignorada pelo banco.
 *
 * Quem chama (a Server Action da tela) deve evitar duas chamadas ao mesmo
 * tempo para a mesma reunião: o resultado seria o mesmo, mas gastaria dois
 * turnos.
 */
export async function processarEscuta(args: {
  deepId: string;
  sessaoId: string;
  analista: servidor.AnalistaDeep;
  chamar: ChamarLLM;
  srv?: ServidorEscuta;
  roteiro?: RoteiroDeep;
}): Promise<ResultadoEscuta> {
  const srv = args.srv ?? servidor;
  const roteiro = args.roteiro ?? roteiroDeep;

  const lidos = await srv.deepEscutaPendentes(args.sessaoId, args.analista);
  if (lidos.error) throw new ErroReuniao("escuta", lidos.error.code);
  const pendentes = lidos.blocos.map(lerBloco).filter((b): b is BlocoEscuta => b !== null);
  if (pendentes.length === 0) return { processados: 0, turno: null, restantes: false, modo: null };

  const lido = await srv.deepEstado(args.deepId, args.analista);
  if (lido.error) throw new ErroReuniao("estado", lido.error.code);
  const estado = lido.estado as EstadoBanco;
  if (estado.deep.pacote_versao !== roteiro.pacoteVersao) throw new ErroReuniao("estado", "pacote_diferente");
  const sessao = estado.sessoes.find((s) => s.id === args.sessaoId);
  if (!sessao) throw new ErroReuniao("estado", "sessao_de_outro_deep");
  const modo = sessao.escuta_modo ?? "desligada";
  if (modo === "desligada") return { processados: 0, turno: null, restantes: true, modo };

  const lote = escolherLote(pendentes);
  const restantes = pendentes.length > lote.length || lidos.blocos.length >= 40;
  const marcar = async (ordemPrimeiraFala: number) => {
    const m = await srv.deepEscutaMarcarProcessados(
      args.sessaoId,
      args.analista,
      lote.map((b) => b.seq),
      ordemPrimeiraFala,
    );
    if (m.error || m.marcados === null) throw new ErroReuniao("escuta", m.error?.code ?? "sem_resultado");
    return m.marcados;
  };

  // Pergunta a pergunta sem pergunta marcada: nada a extrair; só deixa o registro de que o trecho passou.
  const comMarca = lote.some((b) => b.pergunta_marcada && roteiro.porId.has(b.pergunta_marcada));
  if (modo === "pergunta" && !comMarca) {
    const nota: FalaDeep = {
      papel: "analista",
      conteudo: `[Escuta] ${lote.length} trecho(s) sem pergunta marcada; não analisados (modo pergunta a pergunta).`,
    };
    const g = await srv.deepGravarMensagens(args.sessaoId, args.analista, [nota], SEM_USO);
    if (g.error || g.ultimaOrdem === null) throw new ErroReuniao("gravar", g.error?.code ?? "sem_resultado");
    return { processados: await marcar(g.ultimaOrdem), turno: null, restantes, modo };
  }

  const reserva = await srv.deepReservarTurno(args.sessaoId, args.analista);
  if (reserva.error) throw new ErroReuniao("reservar", reserva.error.code);

  const resultado = await executarTurnoDeep({
    roteiro,
    area: sessao.area as AreaDeep,
    falas: reserva.falas as FalaDeep[],
    entrada: montarTextoEscuta({ modo, blocos: lote }),
    contexto: blocoContexto(roteiro, estado, args.sessaoId),
    banco: bancoDaReuniao(srv, roteiro, args.deepId, args.sessaoId, args.analista, srv),
    chamar: args.chamar,
    escuta: { modo, blocos: lote },
    janelaTurnos: JANELA_TURNOS_ESCUTA,
  });

  const gravado = await srv.deepGravarMensagens(args.sessaoId, args.analista, resultado.novas, resultado.uso);
  if (gravado.error || gravado.ultimaOrdem === null) throw new ErroReuniao("gravar", gravado.error?.code ?? "sem_resultado");
  // A fala do analista que levou os blocos é a primeira das gravadas neste turno.
  const processados = await marcar(gravado.ultimaOrdem - resultado.novas.length + 1);
  return { processados, turno: resultado, restantes, modo };
}
