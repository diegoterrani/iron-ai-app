import "server-only";
import type { ChamarLLM } from "@/lib/assessment/agente/conversa";
import { roteiroDeep, type AreaDeep, type RoteiroDeep } from "@/lib/assessment/deep/roteiro";
import * as servidor from "@/lib/supabase/servidor";
import { blocoContexto, estadoParaModelo, type EstadoBanco } from "./contexto";
import type { BancoDeep } from "./ferramentas";
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
    readonly etapa: "reservar" | "estado" | "gravar" | "ferramenta",
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

function bancoDaReuniao(
  srv: ServidorDeep,
  roteiro: RoteiroDeep,
  deepId: string,
  sessaoId: string,
  analista: servidor.AnalistaDeep,
): BancoDeep {
  const lerEstado = async () => {
    const r = await srv.deepEstado(deepId, analista);
    if (r.error) throw new ErroReuniao("estado", r.error.code);
    return r.estado as EstadoBanco;
  };
  return {
    async registrarRespostas(itens) {
      const r = await srv.deepRegistrarRespostas(sessaoId, analista, itens);
      if (r.error || !r.resultado) throw new ErroReuniao("ferramenta", r.error?.code ?? "sem_resultado");
      return r.resultado;
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
  });

  const gravado = await srv.deepGravarMensagens(args.sessaoId, args.analista, resultado.novas, resultado.uso);
  if (gravado.error) throw new ErroReuniao("gravar", gravado.error.code);
  return resultado;
}
