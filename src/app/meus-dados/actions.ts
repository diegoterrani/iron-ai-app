"use server";

import { z } from "zod";
import { executar } from "@/lib/acao/executar";
import type { AcaoState } from "@/lib/acao/tipos";
import { estaLogado } from "@/lib/auth/empresa";

/** LGPD art. 18, VI: o titular pede (ou desiste de) a eliminação da conta. */

const TITULAR = { autorizar: estaLogado, revalidar: "/meus-dados" };
const semCampos = z.object({});

export async function solicitarExclusao(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "lgpd.solicitar_exclusao",
    semCampos,
    form,
    (rpc) => rpc("solicitar_exclusao", {}),
    "Pedido registrado. A equipe conclui em até 15 dias e avisa por e-mail.",
    TITULAR,
  );
  return estado;
}

export async function cancelarExclusao(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "lgpd.cancelar_exclusao",
    semCampos,
    form,
    (rpc) => rpc("cancelar_solicitacao_exclusao", {}),
    "Pedido cancelado. Sua conta continua ativa.",
    TITULAR,
  );
  return estado;
}
