import "server-only";
import { createHash } from "node:crypto";
import { escutaEnv } from "@/lib/env";

/**
 * Token curto da escuta, no mesmo formato que o Worker confere
 * (escuta/src/token.ts): `<payload base64url>.<HMAC-SHA256 base64url>`.
 * O teste tests/unit/escuta-token.test.ts confere este token com o código
 * do próprio Worker, para os dois lados nunca divergirem.
 */

export interface PayloadEscuta {
  sessao: string;
  sub: string;
  exp: number;
}

/** O Worker aceita até 600 s; a folga cobre relógio e rede. */
export const VALIDADE_TOKEN_S = 590;

function base64url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function assinarTokenEscuta(payload: PayloadEscuta, segredo: string): Promise<string> {
  const corpo = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo));
  return `${corpo}.${base64url(new Uint8Array(assinatura))}`;
}

/**
 * Reunião no Worker (um Durable Object): fixa por pessoa e assessment, para
 * duas abas da mesma escuta caírem no mesmo objeto. Formato UUID, derivado
 * por hash: não revela os ids.
 */
export function sessaoDaEscuta(assessmentId: string, userId: string): string {
  const h = createHash("sha256").update(`self:${assessmentId}:${userId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Token para a pessoa abrir (ou renovar) a escuta deste assessment. */
export async function tokenDaEscuta(assessmentId: string, userId: string, agoraMs = Date.now()): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(agoraMs / 1000) + VALIDADE_TOKEN_S;
  const token = await assinarTokenEscuta({ sessao: sessaoDaEscuta(assessmentId, userId), sub: userId, exp }, escutaEnv().ESCUTA_TOKEN_SECRET);
  return { token, exp };
}
