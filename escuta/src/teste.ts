/**
 * Modo de teste da Fase 1: a página de prova de áudio servida pelo próprio
 * Worker, para testar sem instalar nada na máquina.
 *
 * Chave única: o modo existe só enquanto o segredo TESTE_CODIGO estiver
 * cadastrado no Worker. Sem ele, /teste responde 404 e nenhum token é
 * emitido. Apagar o segredo desliga tudo, sem novo deploy de código.
 *
 * Enquanto ligado, quem souber o código consegue transcrever áudio na conta:
 * o código precisa ser longo e o modo deve ficar ligado só durante o teste.
 */

export const TAMANHO_MINIMO_CODIGO = 16;
/** Validade do token de teste, em segundos. */
export const VALIDADE_TOKEN_TESTE_S = 300;

export function modoTesteLigado(codigo: string | undefined): codigo is string {
  return typeof codigo === "string" && codigo.length >= TAMANHO_MINIMO_CODIGO;
}

/**
 * Compara o código digitado com o esperado sem vazar, pelo tempo de
 * resposta, quantos caracteres estão certos: compara os SHA-256 (tamanho
 * fixo) acumulando as diferenças, em vez de parar no primeiro byte errado.
 */
export async function codigoConfere(digitado: string, esperado: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(digitado)),
    crypto.subtle.digest("SHA-256", enc.encode(esperado)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diferenca = 0;
  for (let i = 0; i < x.length; i++) diferenca |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diferenca === 0;
}

/** Cabeçalhos de segurança da página de teste (mesma linha do app: sem inline, sem curinga). */
export function cabecalhosTeste(host: string): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      // WebSocket para o próprio Worker; 'self' não cobre wss em todo navegador.
      `connect-src 'self' wss://${host}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    // Só esta página pode pedir microfone e captura de aba.
    "Permissions-Policy": "microphone=(self), display-capture=(self), camera=(), geolocation=()",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

/** Arquivos da página, em lista fixa: nada vindo da URL escolhe o arquivo. */
export const ARQUIVOS_TESTE: Record<string, string> = {
  "/teste/": "/index.html",
  "/teste/teste.css": "/teste.css",
  "/teste/teste.js": "/teste.js",
  "/teste/captura-worklet.js": "/captura-worklet.js",
};
