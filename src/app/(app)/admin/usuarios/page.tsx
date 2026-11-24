import type { Metadata } from "next";
import Link from "next/link";
import { AcaoForm } from "@/components/acao-form";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { POR_PAGINA, ROTULO_PAPEL, ROTULO_STATUS, STATUS, lerFiltroUsuarios, type Status } from "@/lib/validation/admin";
import { definirStatus } from "../actions";
import { formatarDataHora } from "../formato";

export const metadata: Metadata = { title: "Usuários" };

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  status: Status;
  criado_em: string;
  ultimo_acesso: string | null;
  papeis: string[];
  total: number;
}

function linkPagina(status: Status | null, busca: string, pagina: number): string {
  const p = new URLSearchParams({ status: status ?? "todos", pagina: String(pagina) });
  if (busca) p.set("q", busca);
  return `/admin/usuarios?${p.toString()}`;
}

export default async function UsuariosPage({ searchParams }: PageProps<"/admin/usuarios">) {
  const eu = await exigirSuperAdmin();
  const params = await searchParams;
  const filtro = lerFiltroUsuarios(params);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_listar_usuarios", {
    p_status: filtro.status,
    p_busca: filtro.busca || null,
    p_limite: POR_PAGINA,
    p_offset: (filtro.pagina - 1) * POR_PAGINA,
  });
  const linhas = (data ?? []) as LinhaUsuario[];
  const total = linhas[0]?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  // Aprovar direto da lista (o banco confere de novo; ninguém aprova a si mesmo).
  const comAprovar = linhas.some((u) => u.status === "pendente" && u.id !== eu.id);

  return (
    <main>
      <p className="eyebrow">Backoffice</p>
      <h1 className="title">Usuários</h1>
      {params.excluido === "1" && (
        <p className="notice" role="status">
          Conta excluída. O registro ficou na auditoria.
        </p>
      )}

      <form className="filtro" method="get" role="search">
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filtro.status ?? "todos"}>
            <option value="todos">Todos</option>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="q">Nome ou e-mail</label>
          <input id="q" name="q" type="search" defaultValue={filtro.busca} maxLength={100} />
        </div>
        <button type="submit" className="btn btn-inline">
          Filtrar
        </button>
      </form>

      {error ? (
        <p className="notice notice-error" role="alert">
          Não foi possível carregar a lista agora.
        </p>
      ) : linhas.length === 0 ? (
        <p className="notice">Nenhum usuário encontrado.</p>
      ) : (
        <>
          <p className="field-hint">
            {total} {total === 1 ? "usuário" : "usuários"}
          </p>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">E-mail</th>
                  <th scope="col">Status</th>
                  <th scope="col">Papéis</th>
                  <th scope="col">Cadastro</th>
                  <th scope="col">Último acesso</th>
                  {comAprovar && <th scope="col">Ação</th>}
                </tr>
              </thead>
              <tbody>
                {linhas.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/admin/usuarios/${u.id}`}>{u.nome}</Link>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`selo selo-${u.status}`}>{ROTULO_STATUS[u.status]}</span>
                    </td>
                    <td>{u.papeis.length ? u.papeis.map((p) => ROTULO_PAPEL[p] ?? p).join(", ") : "—"}</td>
                    <td>{formatarDataHora(u.criado_em)}</td>
                    <td>{formatarDataHora(u.ultimo_acesso)}</td>
                    {comAprovar && (
                      <td>
                        {u.status === "pendente" && u.id !== eu.id && (
                          <AcaoForm action={definirStatus} campos={{ userId: u.id, status: "ativo" }} rotulo="Aprovar" rotuloEnviando="Aprovando…" />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {comAprovar && (
            <p className="field-hint">Depois de aprovar, abra a ficha para conceder um papel, vincular a uma empresa ou liberar produtos.</p>
          )}
          {paginas > 1 && (
            <nav className="paginacao" aria-label="Páginas">
              {filtro.pagina > 1 && <Link href={linkPagina(filtro.status, filtro.busca, filtro.pagina - 1)}>Anterior</Link>}
              <span>
                Página {filtro.pagina} de {paginas}
              </span>
              {filtro.pagina < paginas && <Link href={linkPagina(filtro.status, filtro.busca, filtro.pagina + 1)}>Próxima</Link>}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
