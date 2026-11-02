/**
 * Evita open redirect (OWASP A01): o parâmetro `next` só aceita caminhos
 * internos. Qualquer coisa que o navegador possa interpretar como outro
 * host ("//evil.com", "/\\evil.com", "https://...") cai no padrão.
 */
export const DEFAULT_AFTER_LOGIN = "/painel";

export function safeNextPath(input: unknown, fallback = DEFAULT_AFTER_LOGIN): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(input)) return fallback;
  try {
    // Base fictícia: se a URL resolvida mudar de host, era externa.
    const url = new URL(input, "https://interno.invalid");
    if (url.host !== "interno.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
