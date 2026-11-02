import { z } from "zod";

/** Versão dos Termos/Política aceita no cadastro (gravada com a data, LGPD). */
export const TERMOS_VERSAO = "2026-11-02";

const email = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .max(254, "E-mail longo demais.")
  .pipe(z.email({ error: "E-mail inválido." }));

// 12+ caracteres (NIST 800-63B): tamanho pesa mais que regra de símbolo.
// Senhas vazadas são barradas pelo Supabase (proteção HaveIBeenPwned).
const senha = z
  .string({ error: "Informe a senha." })
  .min(12, "A senha precisa ter pelo menos 12 caracteres.")
  .max(128, "A senha pode ter no máximo 128 caracteres.");

export const entrarSchema = z.object({
  email,
  senha: z.string().min(1, "Informe a senha.").max(128),
});

export const cadastroSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome.").max(100, "Nome longo demais."),
  email,
  senha,
  aceiteTermos: z.literal("on", { error: "É preciso aceitar os Termos e a Política de Privacidade." }),
  aceiteMarketing: z.literal("on").optional(),
});

export const recuperarSchema = z.object({ email });

export const redefinirSchema = z
  .object({ senha, confirmacao: z.string() })
  .refine((d) => d.senha === d.confirmacao, {
    message: "As senhas não conferem.",
    path: ["confirmacao"],
  });

/** Converte FormData em objeto simples, ignorando arquivos. */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/** Primeira mensagem de erro por campo, para exibir no formulário. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
