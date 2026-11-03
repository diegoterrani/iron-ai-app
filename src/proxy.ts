import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, generateNonce } from "@/lib/security/csp";

/**
 * Roda antes de cada página: gera o nonce e aplica a CSP.
 * Nas próximas fases também renova a sessão do Supabase e barra rotas
 * sem login.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
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
