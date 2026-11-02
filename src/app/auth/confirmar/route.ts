import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";
import { safeNextPath } from "@/lib/security/redirect";
import { createClient } from "@/lib/supabase/server";

const ALLOWED: ReadonlySet<EmailOtpType> = new Set(["email", "signup", "recovery", "invite", "email_change"]);

/**
 * Link dos e-mails de confirmação, convite e recuperação de senha.
 * Template no Supabase: {{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || tokenHash.length > 512 || !type || !ALLOWED.has(type)) {
    return NextResponse.redirect(new URL("/entrar?erro=link", origin));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) throw error;
    const fallback = type === "recovery" ? "/redefinir-senha" : "/painel";
    return NextResponse.redirect(new URL(safeNextPath(searchParams.get("next"), fallback), origin));
  } catch (err) {
    log("warn", "auth.confirm_failed", { type, reason: (err as Error)?.name });
    return NextResponse.redirect(new URL("/entrar?erro=link", origin));
  }
}
