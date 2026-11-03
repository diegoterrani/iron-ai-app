import { z } from "zod";

/**
 * Leitura validada de variáveis de ambiente. Falha fechado: sem
 * configuração, o login não funciona, em vez de funcionar de forma insegura.
 * Lido por requisição (todas as rotas de auth são dinâmicas), então o build
 * não precisa das variáveis.
 */

/**
 * Em produção, o endereço público precisa ser HTTPS e não pode ser um
 * *.vercel.app: os links de login, confirmação, convite e troca de senha
 * nasceriam apontando para um deploy de preview (já aconteceu em 03/11/2026).
 */
export function siteUrlValidaParaProducao(siteUrl: string): boolean {
  try {
    const url = new URL(siteUrl);
    return url.protocol === "https:" && !url.hostname.endsWith(".vercel.app") && url.pathname === "/";
  } catch {
    return false;
  }
}

const publicSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url().startsWith("https://"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
    NEXT_PUBLIC_SITE_URL: z.url(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(10),
    VERCEL_ENV: z.string().optional(),
  })
  .refine((env) => env.VERCEL_ENV !== "production" || siteUrlValidaParaProducao(env.NEXT_PUBLIC_SITE_URL), {
    path: ["NEXT_PUBLIC_SITE_URL"],
  });

const serverSchema = z.object({
  TURNSTILE_SECRET_KEY: z.string().min(10),
  TURNSTILE_EXPECTED_HOSTNAME: z.string().min(3),
});

export class ConfigError extends Error {
  constructor(missing: string[]) {
    super(`Configuração ausente ou inválida: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

function parse<T extends z.ZodType>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Só os nomes das variáveis vão para o erro, nunca os valores.
    throw new ConfigError(result.error.issues.map((i) => String(i.path[0])));
  }
  return result.data;
}

/**
 * Chave secreta do Supabase (ignora RLS). Usada SÓ em src/lib/supabase/admin.ts,
 * para enviar e-mail de convite depois que o banco autorizou a operação.
 * Nunca com prefixo NEXT_PUBLIC_ (não pode ir para o navegador).
 */
const adminSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
});

export const publicEnv = () => parse(publicSchema);
export const adminEnv = () => parse(adminSchema);
export const serverEnv = () => parse(serverSchema);

export function isSupabaseConfigured(): boolean {
  return publicSchema.safeParse(process.env).success;
}
