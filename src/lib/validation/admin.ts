import { z } from "zod";
import { cnpjValido } from "./cnpj";

export { cnpjValido };

/**
 * Validação do backoffice. A regra de acesso é do banco (funções admin_*);
 * aqui só barramos entrada malformada antes de chegar lá e damos
 * mensagens claras. Nada aqui concede acesso.
 */

export const STATUS = ["pendente", "ativo", "suspenso"] as const;
export type Status = (typeof STATUS)[number];

/** Papéis globais que a tela pode conceder (super_admin só por SQL). */
export const PAPEIS_GLOBAIS = ["equipe_iron", "parceiro", "aluno_b2c"] as const;
/** Papéis dentro de uma empresa. */
export const PAPEIS_EMPRESA = ["master_b2b", "membro_b2b"] as const;

export const ROTULO_PAPEL: Record<string, string> = {
  super_admin: "Super-admin",
  equipe_iron: "Equipe IRON",
  parceiro: "Parceiro",
  master_b2b: "Master B2B",
  membro_b2b: "Membro B2B",
  aluno_b2c: "Aluno B2C",
};

export const ROTULO_STATUS: Record<Status, string> = {
  pendente: "Pendente",
  ativo: "Ativo",
  suspenso: "Suspenso",
};

export const POR_PAGINA = 50;

const id = z.uuid({ error: "Identificador inválido." });

const assentos = z.coerce
  .number({ error: "Informe o número de assentos." })
  .int("Use um número inteiro.")
  .min(1, "Mínimo de 1 assento.")
  .max(10000, "Máximo de 10.000 assentos.");

export const statusSchema = z.object({ userId: id, status: z.enum(STATUS, { error: "Status inválido." }) });

export const papelSchema = z.object({ userId: id, papel: z.enum(PAPEIS_GLOBAIS, { error: "Papel inválido." }) });

export const empresaSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome da empresa.").max(200, "Nome longo demais."),
  cnpj: z
    .string()
    .optional()
    .transform((v) => (v ?? "").replace(/\D/g, ""))
    .refine((v) => v === "" || cnpjValido(v), "CNPJ inválido.")
    .transform((v) => (v === "" ? null : v)),
  assentos,
});

export const assentosSchema = z.object({ orgId: id, assentos });

export const vinculoSchema = z.object({
  orgId: id,
  email: z.string().trim().toLowerCase().max(254).pipe(z.email({ error: "E-mail inválido." })),
  papel: z.enum(PAPEIS_EMPRESA, { error: "Papel inválido." }),
});

export const conviteSchema = z.object({
  orgId: id,
  email: z.string().trim().toLowerCase().max(254).pipe(z.email({ error: "E-mail inválido." })),
});

export const conviteIdSchema = z.object({ conviteId: id });

export const exclusaoSchema = z.object({ solicitacaoId: id });

export const desvinculoSchema = z.object({ orgId: id, userId: id });

/** Produtos que o backoffice libera manualmente (Stripe grava a mesma tabela na fase 4). */
export const PRODUTOS = ["self_assessment"] as const;
export const ROTULO_PRODUTO: Record<(typeof PRODUTOS)[number], string> = { self_assessment: "Self assessment" };

export const direitoSchema = z.object({ userId: id, produto: z.enum(PRODUTOS, { error: "Produto inválido." }) });

export const staffSchema = z.object({
  orgId: id,
  userId: id,
  atribuir: z.enum(["1", "0"]).transform((v) => v === "1"),
});

export function idValido(valor: unknown): valor is string {
  return id.safeParse(valor).success;
}

/** Primeiro valor de um parâmetro de URL (Next entrega string | string[]). */
function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export interface FiltroUsuarios {
  status: Status | null;
  busca: string;
  pagina: number;
}

/**
 * Filtro da lista de usuários vindo da URL. Nunca falha: valor estranho
 * vira o padrão (a lista abre em "pendente", que é o trabalho do dia).
 */
export function lerFiltroUsuarios(params: Record<string, string | string[] | undefined>): FiltroUsuarios {
  const status = primeiro(params.status);
  const pagina = Number.parseInt(primeiro(params.pagina) ?? "1", 10);
  return {
    status: status === "todos" ? null : STATUS.includes(status as Status) ? (status as Status) : "pendente",
    busca: (primeiro(params.q) ?? "").trim().slice(0, 100),
    pagina: Number.isFinite(pagina) && pagina >= 1 && pagina <= 10000 ? pagina : 1,
  };
}

export function lerPagina(valor: string | string[] | undefined): number {
  const n = Number.parseInt(primeiro(valor) ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1;
}

/**
 * Traduz o erro do banco para a tela. As funções admin_* levantam mensagens
 * nossas, em português, com códigos conhecidos; essas podem ser mostradas.
 * Qualquer outra coisa (restrição, erro interno) vira mensagem genérica
 * para não vazar nome de tabela ou detalhe do schema.
 */
export function mensagemErroBanco(erro: { code?: string; message?: string } | null | undefined): string {
  const codigo = erro?.code ?? "";
  const texto = erro?.message ?? "";
  if (codigo === "23505") return "Já existe um registro com esses dados.";
  const nosso = ["42501", "23514", "P0002"].includes(codigo) && !/violates|relation|constraint/i.test(texto);
  if (nosso && texto) return texto.charAt(0).toUpperCase() + texto.slice(1) + ".";
  if (codigo === "42501") return "Operação não permitida.";
  return "Não foi possível concluir agora.";
}
