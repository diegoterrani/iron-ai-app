/**
 * Mapa de rotas públicas. Tudo que não está aqui exige login.
 * Lista de permissão (e não de bloqueio): rota nova nasce protegida.
 */
const PUBLIC_EXACT = new Set(["/", "/entrar", "/cadastro", "/recuperar-senha", "/verifique-email"]);
const PUBLIC_PREFIXES = ["/auth/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Páginas de entrada: quem já está logado é mandado ao painel. */
export function isGuestOnlyPath(pathname: string): boolean {
  return pathname === "/entrar" || pathname === "/cadastro";
}
