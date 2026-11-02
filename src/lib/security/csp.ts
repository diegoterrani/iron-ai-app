/**
 * Content Security Policy da área logada.
 *
 * Por que nonce + 'strict-dynamic': o Next.js injeta scripts inline próprios.
 * Um nonce novo por requisição libera só esses scripts; qualquer script
 * injetado por XSS fica bloqueado (OWASP A03). Ver docs/seguranca.md.
 */

/** Gera um nonce imprevisível (128 bits) em base64, um por requisição. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export interface CspOptions {
  nonce: string;
  /** Em desenvolvimento o React precisa de 'unsafe-eval' para depuração. */
  isDev: boolean;
}

/**
 * Monta o cabeçalho CSP. Origens externas (Supabase, Turnstile, Stripe)
 * entram aqui explicitamente, fase a fase, nunca por curinga.
 */
export function buildCsp({ nonce, isDev }: CspOptions): string {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(nonce)) {
    throw new Error("Nonce inválido para CSP");
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
