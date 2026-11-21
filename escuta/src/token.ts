/**
 * Token curto da escuta: `<payload base64url>.<assinatura base64url>`,
 * HMAC-SHA256 com um segredo que só o app (que emite) e este Worker (que
 * confere) conhecem. O navegador só transporta o token.
 *
 * Por que token próprio e não o cookie do app: o Worker fica em outro
 * domínio e não deve receber a sessão do usuário. O token vale para uma
 * reunião e por poucos minutos; vazado, não dá acesso a mais nada.
 */

export interface PayloadEscuta {
  /** Id da reunião (deep_sessoes.id). Define o Durable Object. */
  sessao: string;
  /** Id do analista, só para o log (sem dado pessoal). */
  sub: string;
  /** Validade, em segundos desde 1970 (UTC). */
  exp: number;
}

export type ResultadoToken = { ok: true; payload: PayloadEscuta } | { ok: false; motivo: "formato" | "assinatura" | "expirado" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Validade máxima aceita, mesmo que o token diga mais (defesa contra emissor mal configurado). */
export const VALIDADE_MAXIMA_S = 10 * 60;

function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  try {
    const binario = atob(texto.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(new ArrayBuffer(binario.length));
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function chave(segredo: string, uso: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, [uso]);
}

/** Usado pelo emissor (app) e pela página de teste; o Worker só confere. */
export async function assinarToken(payload: PayloadEscuta, segredo: string): Promise<string> {
  const corpo = paraBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const assinatura = await crypto.subtle.sign("HMAC", await chave(segredo, "sign"), new TextEncoder().encode(corpo));
  return `${corpo}.${paraBase64Url(new Uint8Array(assinatura))}`;
}

export async function conferirToken(token: string, segredo: string, agoraMs: number): Promise<ResultadoToken> {
  const partes = token.split(".");
  if (partes.length !== 2 || token.length > 1024) return { ok: false, motivo: "formato" };
  const [corpo, assinatura] = partes as [string, string];
  const bytesAssinatura = deBase64Url(assinatura);
  const bytesCorpo = deBase64Url(corpo);
  if (!bytesAssinatura || !bytesCorpo) return { ok: false, motivo: "formato" };

  // crypto.subtle.verify compara em tempo constante: não vaza a assinatura certa byte a byte.
  const valida = await crypto.subtle.verify("HMAC", await chave(segredo, "verify"), bytesAssinatura, new TextEncoder().encode(corpo));
  if (!valida) return { ok: false, motivo: "assinatura" };

  let dados: unknown;
  try {
    dados = JSON.parse(new TextDecoder().decode(bytesCorpo));
  } catch {
    return { ok: false, motivo: "formato" };
  }
  if (typeof dados !== "object" || dados === null) return { ok: false, motivo: "formato" };
  const { sessao, sub, exp } = dados as Record<string, unknown>;
  if (typeof sessao !== "string" || !UUID.test(sessao)) return { ok: false, motivo: "formato" };
  if (typeof sub !== "string" || !UUID.test(sub)) return { ok: false, motivo: "formato" };
  if (typeof exp !== "number" || !Number.isFinite(exp)) return { ok: false, motivo: "formato" };

  const agoraS = Math.floor(agoraMs / 1000);
  if (exp <= agoraS || exp > agoraS + VALIDADE_MAXIMA_S) return { ok: false, motivo: "expirado" };
  return { ok: true, payload: { sessao, sub, exp } };
}
