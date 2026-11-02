import type { Metadata } from "next";
import Link from "next/link";
import { resumoAuditoria, type LinhaAuditoria } from "@/lib/admin/auditoria";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { POR_PAGINA, lerPagina } from "@/lib/validation/admin";
import { formatarDataHora } from "../formato";

export const metadata: Metadata = { title: "Auditoria" };

/** Tabelas com página própria para o alvo (link direto da linha). */
function linkAlvo(linha: LinhaAuditoria): string | null {
  if (!linha.alvo) return null;
  if (linha.tabela === "organizations") return `/admin/empresas/${linha.alvo}`;
  return `/admin/usuarios/${linha.alvo}`;
}

export default async function AuditoriaPage({ searchParams }: PageProps<"/admin/auditoria">) {
  await exigirSuperAdmin();
  const pagina = lerPagina((await searchParams).pagina);
  const supabase = await createClient();

  // Uma página a mais (+1) para saber se existe "Próxima" sem contar a tabela toda.
  const inicio = (pagina - 1) * POR_PAGINA;
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, ator, acao, tabela, alvo, dados, criado_em")
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false })
    .range(inicio, inicio + POR_PAGINA);
  const todas = (data ?? []) as LinhaAuditoria[];
  const linhas = todas.slice(0, POR_PAGINA);
  const temProxima = todas.length > POR_PAGINA;

  // Nomes de quem fez (ator) numa consulta só.
  const atores = [...new Set(linhas.map((l) => l.ator).filter((a): a is string => Boolean(a)))];
  const nomes = new Map<string, string>();
  if (atores.length) {
    const { data: perfis } = await supabase.from("profiles").select("id, nome").in("id", atores);
    for (const p of perfis ?? []) nomes.set(p.id as string, p.nome as string);
  }

  return (
    <main>
      <p className="eyebrow">Backoffice</p>
      <h1 className="title">Auditoria</h1>
      <p className="lead">Toda mudança de status, papel, empresa e atribuição. Os registros não podem ser alterados nem apagados.</p>

      {error ? (
        <p className="notice notice-error" role="alert">
          Não foi possível carregar a auditoria agora.
        </p>
      ) : linhas.length === 0 ? (
        <p className="notice">Nenhum registro.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Quem</th>
                <th scope="col">O quê</th>
                <th scope="col">Alvo</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const href = linkAlvo(l);
                return (
                  <tr key={l.id}>
                    <td>
                      <time dateTime={l.criado_em}>{formatarDataHora(l.criado_em)}</time>
                    </td>
                    <td>{l.ator ? (nomes.get(l.ator) ?? "Usuário removido") : "Sistema (SQL)"}</td>
                    <td>{resumoAuditoria(l)}</td>
                    <td>{href ? <Link href={href}>Abrir</Link> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(pagina > 1 || temProxima) && (
        <nav className="paginacao" aria-label="Páginas">
          {pagina > 1 && <Link href={`/admin/auditoria?pagina=${pagina - 1}`}>Anterior</Link>}
          <span>Página {pagina}</span>
          {temProxima && <Link href={`/admin/auditoria?pagina=${pagina + 1}`}>Próxima</Link>}
        </nav>
      )}
    </main>
  );
}
