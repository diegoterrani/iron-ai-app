"use server";

import { redirect } from "next/navigation";
import { fatorTotpVerificado } from "@/lib/auth/mfa";
import { codigoValido } from "@/lib/validation/auth";
import { log, newTraceId } from "@/lib/log";
import { safeNextPath } from "@/lib/security/redirect";
import { createClient } from "@/lib/supabase/server";

export interface MfaState {
  message?: string;
  /** Passo de cadastro do app autenticador. */
  factorId?: string;
  qrCode?: string;
  secret?: string;
  done?: boolean;
}

const CODIGO_INVALIDO = "Código inválido ou expirado. Confira o app e tente de novo.";

function erro(event: string, err: unknown): MfaState {
  const trace = newTraceId();
  log("error", event, { trace, reason: (err as Error)?.name });
  return { message: `Não foi possível concluir agora (código ${trace}).` };
}

/** Login: confirma o código do app autenticador e sobe a sessão para aal2. */
export async function verificarMfa(_prev: MfaState, form: FormData): Promise<MfaState> {
  const code = form.get("codigo");
  if (!codigoValido(code)) return { message: "Digite os 6 números do app autenticador." };

  let destino: string;
  try {
    const supabase = await createClient();
    const fator = await fatorTotpVerificado(supabase);
    if (!fator) redirect("/painel");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: code.trim() });
    if (error) {
      log("warn", "mfa.verify_failed", { code: error.code });
      return { message: CODIGO_INVALIDO };
    }
    log("info", "mfa.verify_ok");
    destino = safeNextPath(form.get("next"));
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return erro("mfa.verify_error", err);
  }
  redirect(destino);
}

/** Cadastro, passo 1: gera o QR code do app autenticador. */
export async function iniciarCadastroMfa(): Promise<MfaState> {
  try {
    const supabase = await createClient();
    // Remove tentativas anteriores não concluídas (o Supabase limita fatores).
    const { data: lista } = await supabase.auth.mfa.listFactors();
    for (const f of lista?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `App autenticador ${new Date().toISOString().slice(0, 10)}`,
      issuer: "IRON AI",
    });
    if (error) throw error;
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch (err) {
    return erro("mfa.enroll_error", err);
  }
}

/** Cadastro, passo 2: confirma o primeiro código e ativa o fator. */
export async function concluirCadastroMfa(prev: MfaState, form: FormData): Promise<MfaState> {
  const factorId = form.get("factorId");
  const code = form.get("codigo");
  if (typeof factorId !== "string" || !/^[0-9a-f-]{36}$/i.test(factorId)) return { message: "Recomece o cadastro." };
  if (!codigoValido(code)) return { ...prev, message: "Digite os 6 números do app autenticador." };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) {
      log("warn", "mfa.enroll_verify_failed", { code: error.code });
      return { ...prev, message: CODIGO_INVALIDO };
    }
    log("info", "mfa.enrolled");
    return { done: true };
  } catch (err) {
    return erro("mfa.enroll_verify_error", err);
  }
}
