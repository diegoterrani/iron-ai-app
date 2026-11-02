import { log } from "@/lib/log";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileConfig {
  secret: string;
  expectedHostname: string;
}

/**
 * Valida o token do Turnstile no servidor. Falha fechado: rede fora,
 * resposta estranha ou hostname diferente contam como reprovado.
 * Em desenvolvimento use as chaves de teste da Cloudflare, nunca um bypass.
 */
export async function verifyTurnstile(
  token: unknown,
  remoteIp: string | null,
  config: TurnstileConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;

  const body = new URLSearchParams({ secret: config.secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetchImpl(SITEVERIFY, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log("warn", "turnstile.http_error", { status: res.status });
      return false;
    }
    const data = (await res.json()) as { success?: boolean; hostname?: string; "error-codes"?: string[] };
    if (data.success !== true) {
      log("warn", "turnstile.rejected", { codes: data["error-codes"] ?? [] });
      return false;
    }
    if (data.hostname !== config.expectedHostname) {
      log("warn", "turnstile.hostname_mismatch", { hostname: data.hostname });
      return false;
    }
    return true;
  } catch (err) {
    log("error", "turnstile.unreachable", { error: (err as Error).name });
    return false;
  }
}
