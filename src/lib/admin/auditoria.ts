import { ROTULO_PAPEL, ROTULO_PRODUTO, ROTULO_STATUS, type Status } from "@/lib/validation/admin";

export interface LinhaAuditoria {
  id: number;
  ator: string | null;
  acao: string;
  tabela: string;
  alvo: string | null;
  dados: { antes?: Record<string, unknown> | null; depois?: Record<string, unknown> | null } | null;
  criado_em: string;
}

const ACAO: Record<string, string> = { insert: "criou", update: "alterou", delete: "removeu" };

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor) : "";
}

function produto(valor: unknown): string {
  const t = texto(valor);
  return ROTULO_PRODUTO[t as keyof typeof ROTULO_PRODUTO] ?? t;
}

const ETAPA_ASSESSMENT: Record<string, string> = {
  assessment_iniciado: "Self assessment iniciado",
  assessment_concluido: "Self assessment concluído",
  assessment_descartado: "Rascunho do Self assessment descartado",
  assessment_editado: "Self assessment da empresa editado",
  assessment_excluido: "Self assessment excluído (com resultado e conversas)",
};

function papel(valor: unknown): string {
  const t = texto(valor);
  return ROTULO_PAPEL[t] ?? t;
}

/**
 * Frase curta e legível para uma linha da auditoria. Mostra só campos
 * conhecidos (papel, status, nome, assentos); nunca despeja o JSON bruto.
 */
export function resumoAuditoria(linha: Pick<LinhaAuditoria, "acao" | "tabela" | "dados">): string {
  const antes = linha.dados?.antes ?? {};
  const depois = linha.dados?.depois ?? {};
  const atual = linha.acao === "delete" ? antes : depois;

  switch (linha.tabela) {
    case "profiles": {
      if (linha.acao === "usuario_exclusao_autorizada") {
        return `Exclusão da conta autorizada pelo backoffice: ${texto((linha.dados as Record<string, unknown> | null)?.motivo)}`;
      }
      if (linha.acao === "usuario_excluido") return `Conta excluída pelo backoffice: ${texto((linha.dados as Record<string, unknown> | null)?.motivo)}`;
      const de = ROTULO_STATUS[texto(antes.status) as Status] ?? texto(antes.status);
      const para = ROTULO_STATUS[texto(depois.status) as Status] ?? texto(depois.status);
      return `Status: ${de} → ${para}`;
    }
    case "user_roles":
      return linha.acao === "delete" ? `Papel revogado: ${papel(atual.role)}` : `Papel concedido: ${papel(atual.role)}`;
    case "memberships":
      if (linha.acao === "update") return `Papel na empresa: ${papel(antes.role)} → ${papel(depois.role)}`;
      return linha.acao === "delete"
        ? `Saiu da empresa (${papel(atual.role)})`
        : `Entrou na empresa como ${papel(atual.role)}`;
    case "staff_assignments":
      return linha.acao === "delete" ? "Atribuição a empresa removida" : "Atribuído a uma empresa";
    case "organizations":
      if (linha.acao === "empresa_excluida") {
        return `Empresa excluída: ${texto((linha.dados as Record<string, unknown> | null)?.nome)} (${texto((linha.dados as Record<string, unknown> | null)?.motivo)})`;
      }
      if (linha.acao === "update" && antes.assentos !== depois.assentos) {
        return `Assentos: ${texto(antes.assentos)} → ${texto(depois.assentos)}`;
      }
      return `Empresa ${ACAO[linha.acao] ?? linha.acao}: ${texto(atual.nome)}`;
    case "direitos":
      if (linha.acao === "update" && depois.revogado_em) return `Acesso revogado: ${produto(atual.produto)}`;
      return linha.acao === "delete" ? `Acesso removido: ${produto(atual.produto)}` : `Acesso liberado: ${produto(atual.produto)}`;
    case "assessments":
      // Auditoria própria: só etapa e setor, nunca as respostas.
      if (linha.acao === "assessment_removido") {
        // Remoção pelo super-admin grava o motivo direto em dados.
        const motivo = texto((linha.dados as Record<string, unknown> | null)?.motivo);
        return motivo ? `Self assessment removido pelo admin: ${motivo}` : "Self assessment removido pelo admin";
      }
      if (linha.acao === "assessment_transferido") {
        const motivo = texto((linha.dados as Record<string, unknown> | null)?.motivo);
        return motivo ? `Self assessment transferido para a empresa: ${motivo}` : "Self assessment transferido para a empresa";
      }
      return ETAPA_ASSESSMENT[linha.acao] ?? "Self assessment atualizado";
    case "empresas_cadastro":
      if (linha.acao === "cadastro_empresa_excluido") {
        return `Cadastro de empresa do Self excluído: ${texto((linha.dados as Record<string, unknown> | null)?.nome)}`;
      }
      return `Cadastro de empresa ${ACAO[linha.acao] ?? linha.acao}`;
    default:
      return `${ACAO[linha.acao] ?? linha.acao} em ${linha.tabela}`;
  }
}
