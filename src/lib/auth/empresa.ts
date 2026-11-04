import "server-only";
import { getSessao } from "@/lib/auth/session";

/** Checagem rápida para a tela: é ADM-Cliente de alguma empresa? (o banco decide de verdade) */
export async function eGestorDeEmpresa(): Promise<boolean> {
  const sessao = await getSessao();
  return sessao?.perfil?.status === "ativo" && (sessao?.gestorDe.length ?? 0) > 0;
}

/** Checagem rápida para o convidado: está logado? (aceitar exige e-mail confirmado no banco) */
export async function estaLogado(): Promise<boolean> {
  return Boolean((await getSessao())?.perfil);
}
