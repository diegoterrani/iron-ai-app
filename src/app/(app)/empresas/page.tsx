import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirContaAtiva } from "@/lib/auth/session";
import { escopoEmpresas } from "@/lib/empresa/area";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Empresas" };

/**
 * Porta de entrada da área da empresa. Quem tem uma empresa só vai direto
 * para ela; quem atende várias (ou o super-admin) escolhe na lista. O RLS
 * de organizations decide o que aparece.
 */
export default async function EmpresasPage() {
  await exigirContaAtiva();
  const { todas, ids } = await escopoEmpresas();
  if (!todas && ids.length === 0) redirect("/painel");

  const supabase = await createClient();
  let consulta = supabase.from("organizations").select("id, nome").order("nome").limit(500);
  if (!todas) consulta = consulta.in("id", ids);
  const { data, error } = await consulta;
  const empresas = (data ?? []) as { id: string; nome: string }[];
  if (!error && empresas.length === 1) redirect(`/empresas/${empresas[0].id}`);

  return (
    <main>
      <p className="eyebrow">Área da empresa</p>
      <h1 className="title">Empresas</h1>
      <p className="lead">Cadastro, pessoas, Self assessment, Deep assessment e o resumo de cada empresa num lugar só.</p>
      {error ? (
        <p className="notice notice-error" role="alert">
          Não foi possível carregar as empresas agora.
        </p>
      ) : empresas.length === 0 ? (
        <p className="notice">Nenhuma empresa para mostrar.</p>
      ) : (
        <ul className="lista">
          {empresas.map((e) => (
            <li key={e.id}>
              <Link href={`/empresas/${e.id}`}>{e.nome}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
