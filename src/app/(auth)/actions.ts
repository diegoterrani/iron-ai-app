"use server";

import { redirect } from "next/navigation";
import { precisaSegundoFator } from "@/lib/auth/mfa";
import { clientIp } from "@/lib/auth/request";
import { ConfigError, publicEnv, serverEnv } from "@/lib/env";
import { log, maskEmail, newTraceId } from "@/lib/log";
import { safeNextPath } from "@/lib/security/redirect";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createClient } from "@/lib/supabase/server";
import {
  TERMOS_VERSAO,
  cadastroSchema,
  entrarSchema,
  fieldErrors,
  formToObject,
  recuperarSchema,
  redefinirSchema,
} from "@/lib/validation/auth";

export interface FormState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const GENERIC = "Não foi possível concluir agora. Tente de novo em instantes.";

/** Mensagem genérica com código de rastreio; o detalhe fica só no log. */
function failure(event: string, err: unknown): FormState {
  const trace = newTraceId();
  const reason = err instanceof ConfigError ? "config" : (err as Error)?.name ?? "desconhecido";
  log("error", event, { trace, reason });
  return { message: `${GENERIC} (código ${trace})` };
}

async function passedTurnstile(form: FormData): Promise<boolean> {
  const env = serverEnv();
  return verifyTurnstile(form.get("cf-turnstile-response"), await clientIp(), {
    secret: env.TURNSTILE_SECRET_KEY,
    expectedHostname: env.TURNSTILE_EXPECTED_HOSTNAME,
  });
}

const ROBOT = { message: "Não conseguimos confirmar que você não é um robô. Tente de novo." };

export async function entrar(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = entrarSchema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  let destino: string;
  try {
    if (!(await passedTurnstile(form))) return ROBOT;

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.senha,
    });

    if (error) {
      log("warn", "auth.login_failed", { email: maskEmail(parsed.data.email), code: error.code });
      if (error.code === "email_not_confirmed") {
        return { message: "Confirme seu e-mail pelo link que enviamos antes de entrar." };
      }
      // Mesma mensagem para e-mail inexistente e senha errada (evita enumeração).
      return { message: "E-mail ou senha inválidos." };
    }
    log("info", "auth.login_ok", { email: maskEmail(parsed.data.email) });
    destino = safeNextPath(form.get("next"));
    // Quem tem app autenticador digita o código antes de entrar.
    if (await precisaSegundoFator(supabase)) {
      destino = `/verificar-mfa?next=${encodeURIComponent(destino)}`;
    }
  } catch (err) {
    return failure("auth.login_error", err);
  }
  redirect(destino);
}

export async function cadastrar(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = cadastroSchema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    if (!(await passedTurnstile(form))) return ROBOT;

    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.senha,
      options: {
        emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirmar`,
        // Lido pelo gatilho do banco que cria o perfil (status "pendente").
        data: {
          nome: parsed.data.nome,
          aceite_termos_versao: TERMOS_VERSAO,
          aceite_marketing: parsed.data.aceiteMarketing === "on",
        },
      },
    });

    if (error) {
      if (error.code === "weak_password") {
        return { errors: { senha: "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra." } };
      }
      if (error.code !== "user_already_exists" && error.code !== "email_exists") {
        log("warn", "auth.signup_failed", { email: maskEmail(parsed.data.email), code: error.code });
        return { message: GENERIC };
      }
      // E-mail já cadastrado: mesma resposta de sucesso (evita enumeração).
    }
    log("info", "auth.signup", { email: maskEmail(parsed.data.email) });
  } catch (err) {
    return failure("auth.signup_error", err);
  }
  redirect("/verifique-email");
}

const PROVIDERS = { google: "google", microsoft: "azure" } as const;

export async function entrarComProvedor(form: FormData): Promise<void> {
  const key = String(form.get("provedor"));
  const provider = PROVIDERS[key as keyof typeof PROVIDERS];
  if (!provider) redirect("/entrar?erro=provedor");

  let url: string | null = null;
  try {
    const next = safeNextPath(form.get("next"));
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`,
        // Entra ID: o e-mail precisa vir no token para unir contas com segurança.
        scopes: provider === "azure" ? "email" : undefined,
      },
    });
    if (error) throw error;
    url = data.url;
  } catch (err) {
    failure("auth.oauth_start_error", err);
  }
  redirect(url ?? "/entrar?erro=oauth");
}

export async function recuperarSenha(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = recuperarSchema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    if (!(await passedTurnstile(form))) return ROBOT;
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirmar?next=/redefinir-senha`,
    });
    if (error) log("warn", "auth.reset_failed", { email: maskEmail(parsed.data.email), code: error.code });
  } catch (err) {
    return failure("auth.reset_error", err);
  }
  // Sempre a mesma resposta, exista ou não a conta.
  return { ok: true, message: "Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha." };
}

export async function redefinirSenha(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = redefinirSchema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.senha });
    if (error) {
      if (error.code === "weak_password" || error.code === "same_password") {
        return { errors: { senha: "Escolha uma senha diferente e mais forte." } };
      }
      return failure("auth.update_password_failed", error);
    }
    log("info", "auth.password_changed");
  } catch (err) {
    return failure("auth.update_password_error", err);
  }
  redirect("/painel");
}

export async function sair(): Promise<void> {
  try {
    const supabase = await createClient();
    // Revoga o token de renovação desta sessão no servidor do Supabase.
    await supabase.auth.signOut({ scope: "local" });
  } catch (err) {
    failure("auth.logout_error", err);
  }
  redirect("/entrar");
}
