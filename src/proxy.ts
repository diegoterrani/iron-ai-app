import { NextResponse, type NextRequest } from "next/server";
import { isGuestOnlyPath, isPublicPath } from "@/lib/auth/routes";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { DEFAULT_AFTER_LOGIN } from "@/lib/security/redirect";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Roda antes de cada página:
 * 1. gera o nonce e aplica a CSP;
 * 2. renova a sessão do Supabase;
 * 3. barra rotas protegidas sem login (o status da conta e o papel são
 *    checados no servidor e no banco, não aqui).
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { response, userId } = await updateSession(request, requestHeaders);
  const { pathname, search } = request.nextUrl;

  let result: NextResponse = response;
  if (!userId && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    result = redirectKeepingCookies(url, response);
  } else if (userId && isGuestOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = DEFAULT_AFTER_LOGIN;
    url.search = "";
    result = redirectKeepingCookies(url, response);
  }

  result.headers.set("Content-Security-Policy", csp);
  return result;
}

/** Redireciona sem perder cookies de sessão renovados nesta requisição. */
function redirectKeepingCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    {
      // Tudo, exceto arquivos estáticos e a API (que não serve HTML).
      source: "/((?!api|_next/static|_next/image|icon.svg|logo-lockup.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
