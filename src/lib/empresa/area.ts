import "server-only";
import { getSessao } from "@/lib/auth/session";

/** Papéis globais que enxergam todas as empresas (o RLS confere com MFA). */
const VE_TODAS = new Set(["super_admin"]);

/**
 * Empresas que a pessoa pode abrir na área da empresa: as que ela integra
 * (ADM, RW ou RO-Cliente), as que atende pela IRON e, para o super-admin,
 * todas. Só decide o que a TELA lista; cada leitura passa pelo RLS.
 */
export async function escopoEmpresas(): Promise<{ todas: boolean; ids: string[] }> {
  const sessao = await getSessao();
  if (!sessao?.perfil || sessao.perfil.status !== "ativo") return { todas: false, ids: [] };
  const todas = sessao.papeis.some((p) => VE_TODAS.has(p));
  const ids = [...new Set([...sessao.vinculos.map((v) => v.orgId), ...sessao.atendidas])];
  return { todas, ids };
}

/** Item "Empresas" no menu: só para quem tem alguma empresa para abrir. */
export async function temAreaDeEmpresa(): Promise<boolean> {
  const { todas, ids } = await escopoEmpresas();
  return todas || ids.length > 0;
}

/** Retorno e veredito do Self (motor 0.6.0 em diante); null em formato antigo. */
export function resumoResultado(resultado: unknown): { retorno: number; veredito: string } | null {
  const regua = (resultado as { regua?: { retorno_x?: unknown; veredito?: unknown } } | null)?.regua;
  if (!regua || typeof regua.retorno_x !== "number" || typeof regua.veredito !== "string") return null;
  return { retorno: regua.retorno_x, veredito: regua.veredito };
}

export const ROTULO_VEREDITO: Record<string, string> = {
  seguir: "seguir com o projeto",
  deep_para_confirmar: "confirmar no Deep",
  comecar_pequeno: "começar pequeno",
};
