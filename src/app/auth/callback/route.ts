import { NextResponse, type NextRequest } from "next/server";
import { log, newTraceId } from "@/lib/log";
import { safeNextPath } from "@/lib/security/redirect";
import { createClient } from "@/lib/supabase/server";

/** Retorno do Google / Microsoft (fluxo PKCE): troca o código pela sessão. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code || code.length > 512) {
    return NextResponse.redirect(new URL("/entrar?erro=oauth", origin));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    log("info", "auth.oauth_ok");
    return NextResponse.redirect(new URL(next, origin));
  } catch (err) {
    log("warn", "auth.oauth_callback_failed", { trace: newTraceId(), reason: (err as Error)?.name });
    return NextResponse.redirect(new URL("/entrar?erro=oauth", origin));
  }
}
