import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { PAPEIS_EMPRESA, ROTULO_PAPEL, idValido } from "@/lib/validation/admin";
import { AcaoForm } from "@/components/acao-form";
import { atribuirStaff, definirAssentos, desvincularEmpresa, vincularEmpresa } from "../../actions";
import { formatarCnpj, formatarDataHora } from "../../formato";

export const metadata: Metadata = { title: "Empresa" };

interface Empresa {
  id: string;
  nome: string;
  cnpj: string | null;
  assentos: number;
  created_at: string;
}

interface Pessoa {
  user_id: string;
  role?: string;
  profiles: { nome: string; status: string } | null;
}

export default async function EmpresaPage({ params }: PageProps<"/admin/empresas/[id]">) {
  await exigirSuperAdmin();
  const { id } = await params;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  const [empresaRes, membrosRes, staffRes] = await Promise.all([
    supabase.from("organizations").select("id, nome, cnpj, assentos, created_at").eq("id", id).maybeSingle<Empresa>(),
    // Duas FKs para profiles (user_id e adicionado_por): o nome da FK desfaz a ambiguidade.
    supabase
      .from("memberships")
      .select("user_id, role, profiles!memberships_user_id_fkey(nome, status)")
      .eq("org_id", id)
      .order("role"),
    supabase
      .from("staff_assignments")
      .select("user_id, profiles!staff_assignments_user_id_fkey(nome, status)")
      .eq("org_id", id),
  ]);

  const empresa = empresaRes.data;
  if (!empresa) notFound();
  const membros = (membrosRes.data ?? []) as unknown as Pessoa[];
  const staff = (staffRes.data ?? []) as unknown as Pessoa[];
  const livres = empresa.assentos - membros.length;

  return (
    <main>
      <p className="eyebrow">
        <Link href="/admin/empresas">Empresas</Link> / ficha
      </p>
      <h1 className="title">{empresa.nome}</h1>

      <dl className="ficha">
        <dt>CNPJ</dt>
        <dd>{formatarCnpj(empresa.cnpj)}</dd>
        <dt>Assentos</dt>
        <dd>
          {membros.length} usados de {empresa.assentos} ({livres} {livres === 1 ? "livre" : "livres"})
        </dd>
        <dt>Criada em</dt>
        <dd>{formatarDataHora(empresa.created_at)}</dd>
      </dl>

      <section className="secao" aria-labelledby="sec-assentos">
        <h2 id="sec-assentos">Limite de assentos</h2>
        <AcaoForm action={definirAssentos} campos={{ orgId: empresa.id }} rotulo="Salvar">
          <div className="field">
            <label htmlFor="assentos">Assentos</label>
            <input id="assentos" name="assentos" type="number" min={1} max={10000} defaultValue={empresa.assentos} required />
          </div>
        </AcaoForm>
      </section>

      <section className="secao" aria-labelledby="sec-membros">
        <h2 id="sec-membros">Pessoas da empresa</h2>
        {membros.length === 0 ? (
          <p className="field-hint">Ninguém vinculado ainda. Comece pelo Master B2B.</p>
        ) : (
          <ul className="lista">
            {membros.map((m) => (
              <li key={m.user_id}>
                <span>
                  <Link href={`/admin/usuarios/${m.user_id}`}>{m.profiles?.nome ?? "Usuário"}</Link> ·{" "}
                  {ROTULO_PAPEL[m.role ?? ""] ?? m.role}
                  {m.profiles?.status !== "ativo" && ` · ${m.profiles?.status ?? ""}`}
                </span>
                <AcaoForm
                  action={desvincularEmpresa}
                  campos={{ orgId: empresa.id, userId: m.user_id }}
                  rotulo="Remover"
                  rotuloEnviando="Removendo…"
                  variante="secundario"
                />
              </li>
            ))}
          </ul>
        )}
        <AcaoForm
          action={vincularEmpresa}
          campos={{ orgId: empresa.id }}
          rotulo="Vincular"
          rotuloEnviando="Vinculando…"
          className="acao-form acao-form-coluna"
        >
          <div className="field">
            <label htmlFor="email">E-mail da pessoa (já cadastrada)</label>
            <input id="email" name="email" type="email" autoComplete="off" required maxLength={254} />
          </div>
          <div className="field">
            <label htmlFor="papel">Papel</label>
            <select id="papel" name="papel" defaultValue={membros.some((m) => m.role === "master_b2b") ? "membro_b2b" : "master_b2b"}>
              {PAPEIS_EMPRESA.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAPEL[p]}
                </option>
              ))}
            </select>
          </div>
        </AcaoForm>
        <p className="field-hint">Se a pessoa já estiver na empresa, o papel é atualizado. A conta precisa estar ativa para ter acesso.</p>
      </section>

      <section className="secao" aria-labelledby="sec-staff">
        <h2 id="sec-staff">Equipe IRON e parceiros que atendem</h2>
        {staff.length === 0 ? (
          <p className="field-hint">Ninguém atribuído. Atribua pela ficha do consultor ou parceiro.</p>
        ) : (
          <ul className="lista">
            {staff.map((s) => (
              <li key={s.user_id}>
                <Link href={`/admin/usuarios/${s.user_id}`}>{s.profiles?.nome ?? "Usuário"}</Link>
                <AcaoForm
                  action={atribuirStaff}
                  campos={{ orgId: empresa.id, userId: s.user_id, atribuir: "0" }}
                  rotulo="Remover"
                  rotuloEnviando="Removendo…"
                  variante="secundario"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
