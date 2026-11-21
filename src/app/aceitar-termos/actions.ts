"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { executar } from "@/lib/acao/executar";
import type { AcaoState } from "@/lib/acao/tipos";
import { estaLogado } from "@/lib/auth/empresa";
import { TERMOS_VERSAO } from "@/lib/validation/auth";

/**
 * Aceite dos Termos e da Política no primeiro acesso (quem entrou pelo Google
 * ou por convite não passou pelo checkbox do cadastro). A versão gravada é a
 * do servidor, nunca a que vem do formulário; o banco grava só no próprio perfil.
 */
const schema = z.object({
  aceiteTermos: z.literal("on", { error: "É preciso aceitar os Termos e a Política de Privacidade." }),
  aceiteMarketing: z.literal("on").optional(),
});

export async function aceitarTermos(_prev: AcaoState, form: FormData): Promise<AcaoState> {
  const { estado } = await executar(
    "lgpd.aceitar_termos",
    schema,
    form,
    (rpc, dados) => rpc("aceitar_termos", { p_versao: TERMOS_VERSAO, p_marketing: dados.aceiteMarketing === "on" }),
    "Aceite registrado.",
    { autorizar: estaLogado, revalidar: "/" },
  );
  if (!estado.ok) return estado;
  redirect("/painel");
}
