import type { Metadata } from "next";
import Link from "next/link";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { AcaoForm } from "@/components/acao-form";
import { criarEmpresa } from "../actions";
import { formatarCnpj, formatarDataHora } from "../formato";

export const metadata: Metadata = { title: "Empresas" };

interface LinhaEmpresa {
  id: string;
  nome: string;
  cnpj: string | null;
  assentos: number;
  created_at: string;
  memberships: { count: number }[];
}

export default async function EmpresasPage() {
  await exigirSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, nome, cnpj, assentos, created_at, memberships(count)")
    .order("nome")
    .limit(500);
  const empresas = (data ?? []) as unknown as LinhaEmpresa[];

  return (
    <main>
      <p className="eyebrow">Backoffice</p>
      <h1 className="title">Empresas</h1>

      {error ? (
        <p className="notice notice-error" role="alert">
          Não foi possível carregar as empresas agora.
        </p>
      ) : empresas.length === 0 ? (
        <p className="notice">Nenhuma empresa cadastrada.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">CNPJ</th>
                <th scope="col">Assentos usados</th>
                <th scope="col">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/admin/empresas/${e.id}`}>{e.nome}</Link>
                  </td>
                  <td>{formatarCnpj(e.cnpj)}</td>
                  <td>
                    {e.memberships[0]?.count ?? 0} de {e.assentos}
                  </td>
                  <td>{formatarDataHora(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="secao" aria-labelledby="sec-nova">
        <h2 id="sec-nova">Nova empresa</h2>
        <AcaoForm action={criarEmpresa} rotulo="Criar empresa" rotuloEnviando="Criando…" className="acao-form acao-form-coluna">
          <div className="field">
            <label htmlFor="nome">Nome</label>
            <input id="nome" name="nome" required maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="cnpj">CNPJ (opcional)</label>
            <input id="cnpj" name="cnpj" inputMode="numeric" maxLength={18} />
          </div>
          <div className="field">
            <label htmlFor="assentos">Assentos (Master + Membros)</label>
            <input id="assentos" name="assentos" type="number" min={1} max={10000} defaultValue={5} required />
          </div>
        </AcaoForm>
      </section>
    </main>
  );
}
