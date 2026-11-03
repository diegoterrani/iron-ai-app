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

/** Endereço de branch que a Vercel informa nos previews (sem esquema). */
const BRANCH_URL = /^[a-z0-9-]+\.vercel\.app$/;

const publicSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url().startsWith("https://"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
    // Opcional só nos previews da Vercel, que usam o endereço da própria branch.
    NEXT_PUBLIC_SITE_URL: z.url().optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(10),
    VERCEL_ENV: z.string().optional(),
    // Validado só no preview: em produção não é usado e não pode derrubar o login.
    VERCEL_BRANCH_URL: z.string().optional(),
  })
  .refine(
    (env) => {
      if (env.VERCEL_ENV === "production") {
        return !!env.NEXT_PUBLIC_SITE_URL && siteUrlValidaParaProducao(env.NEXT_PUBLIC_SITE_URL);
      }
      if (env.VERCEL_ENV === "preview") return BRANCH_URL.test(env.VERCEL_BRANCH_URL ?? "");
      return !!env.NEXT_PUBLIC_SITE_URL;
    },
    { path: ["NEXT_PUBLIC_SITE_URL"] },
  );

type PublicEnv = z.infer<typeof publicSchema>;

/**
 * Endereço público do app, usado nos links de login, confirmação, convite e
 * troca de senha.
 * - Produção: NEXT_PUBLIC_SITE_URL (validada acima: https://app.iron-ai.io).
 * - Preview da Vercel: o endereço da própria branch. Cada branch tem o seu, então
 *   um valor fixo na variável estaria errado para os outros previews.
 * - Local e testes: NEXT_PUBLIC_SITE_URL.
 */
export function resolverSiteUrl(env: Pick<PublicEnv, "NEXT_PUBLIC_SITE_URL" | "VERCEL_ENV" | "VERCEL_BRANCH_URL">): string {
  if (env.VERCEL_ENV === "preview" && BRANCH_URL.test(env.VERCEL_BRANCH_URL ?? "")) return `https://${env.VERCEL_BRANCH_URL}`;
  if (!env.NEXT_PUBLIC_SITE_URL) throw new ConfigError(["NEXT_PUBLIC_SITE_URL"]);
  return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

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

/**
 * Chave da API da Anthropic para o agente do Self assessment. Só no servidor
 * (nunca NEXT_PUBLIC_); sem ela, a conversa fica indisponível e o formulário
 * continua funcionando.
 */
const llmSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(20),
});

export const publicEnv = () => parse(publicSchema);
export const siteUrl = () => resolverSiteUrl(publicEnv());
export const adminEnv = () => parse(adminSchema);
export const serverEnv = () => parse(serverSchema);
export const llmEnv = () => parse(llmSchema);
export const agenteConfigurado = () => llmSchema.safeParse(process.env).success;

export function isSupabaseConfigured(): boolean {
  return publicSchema.safeParse(process.env).success;
}
