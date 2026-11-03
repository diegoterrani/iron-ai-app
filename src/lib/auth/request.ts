import "server-only";
import { headers } from "next/headers";

/** IP do cliente atrás de Cloudflare + Vercel, para o Turnstile e logs. */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return ip && ip.length <= 64 ? ip : null;
}

/** Nonce da CSP desta requisição, gerado no proxy. */
export async function cspNonce(): Promise<string | undefined> {
  return (await headers()).get("x-nonce") ?? undefined;
}
