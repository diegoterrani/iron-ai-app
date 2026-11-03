/**
 * Log estruturado (JSON) para os logs da Vercel.
 * Regra: nunca registrar senha, token, cookie ou e-mail completo.
 */

type Level = "info" | "warn" | "error";

/** Mascara e-mail: "diego@iron.com" vira "d***@iron.com". */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user[0]}***@${domain}`;
}

/** Código curto para o usuário citar ao suporte; liga a tela ao log. */
export function newTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function log(level: Level, event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
