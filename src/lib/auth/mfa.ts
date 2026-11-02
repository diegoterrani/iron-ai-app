import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * True quando o usuário tem app autenticador ativo mas a sessão ainda está
 * em aal1 (só senha / OAuth). Nesse caso ele precisa digitar o código.
 */
export async function precisaSegundoFator(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.currentLevel === "aal1" && data.nextLevel === "aal2";
}

/** Fator TOTP já verificado do usuário, se houver. */
export async function fatorTotpVerificado(supabase: SupabaseClient) {
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.totp.find((f) => f.status === "verified") ?? null;
}
