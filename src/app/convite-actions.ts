"use server";

import { executar } from "@/lib/acao/executar";
import type { AcaoState } from "@/lib/acao/tipos";
import { estaLogado } from "@/lib/auth/empresa";
import { conviteIdSchema } from "@/lib/validation/admin";

/**
 * O convidado aceita ou recusa. O banco só deixa quem tem o e-mail
 * CONFIRMADO igual ao do convite (vale para conta ainda pendente).
 */

const CONVIDADO = { autorizar: estaLogado, revalidar: "/" };

export async function aceitarConvite(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "convite.aceitar",
    conviteIdSchema,
    form,
    (rpc, d) => rpc("aceitar_convite", { p_convite: d.conviteId }),
    "Convite aceito. Seu acesso pela empresa está liberado.",
    CONVIDADO,
  );
  return estado;
}

export async function recusarConvite(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "convite.recusar",
    conviteIdSchema,
    form,
    (rpc, d) => rpc("recusar_convite", { p_convite: d.conviteId }),
    "Convite recusado.",
    CONVIDADO,
  );
  return estado;
}
