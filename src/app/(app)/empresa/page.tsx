import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AcaoForm } from "@/components/acao-form";
import { exigirContaAtiva, getSessao } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DESCRICAO_PAPEL_CLIENTE, PAPEIS_CONVITE, ROTULO_PAPEL, ROTULO_STATUS, type Status } from "@/lib/validation/admin";
import { alterarPapel, cancelarConvite, convidarMembro, removerMembro } from "./actions";

export const metadata: Metadata = { title: "Minha empresa" };

interface Membro {
  user_id: string;
  nome: string;
  email: string;
  role: string;
  status: Status;
}

interface Convite {
  id: string;
  email: string;
  role: string;
  expira_em: string;
}

/** RW e RO o ADM-Cliente gere; ADM só o super-admin. */
const geridoPeloAdm = (role: string) => (PAPEIS_CONVITE as readonly string[]).includes(role);

const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

async function SecaoEmpresa({ orgId, euId }: { orgId: string; euId: string }) {
  const supabase = await createClient();
  const [empresaRes, membrosRes, convitesRes] = await Promise.all([
    supabase.from("organizations").select("id, nome, assentos").eq("id", orgId).maybeSingle(),
    supabase.rpc("empresa_listar_membros", { p_org: orgId }),
    supabase
      .from("convites")
      .select("id, email, role, expira_em")
      .eq("org_id", orgId)
      .is("aceito_em", null)
      .is("cancelado_em", null)
      .gt("expira_em", new Date().toISOString())
      .order("criado_em"),
  ]);
  const empresa = empresaRes.data as { id: string; nome: string; assentos: number } | null;
  // Sem permissão no banco (ex.: deixou de ser ADM-Cliente): não mostra nada.
  if (!empresa || membrosRes.error) return null;

  const membros = (membrosRes.data ?? []) as Membro[];
  const convites = (convitesRes.data ?? []) as Convite[];
  const livres = empresa.assentos - membros.length - convites.length;

  return (
    <section className="secao" aria-labelledby={`empresa-${empresa.id}`}>
      <h2 id={`empresa-${empresa.id}`}>{empresa.nome}</h2>
      <p className="field-hint">
        {membros.length} {membros.length === 1 ? "pessoa" : "pessoas"} e {convites.length}{" "}
        {convites.length === 1 ? "convite pendente" : "convites pendentes"} de {empresa.assentos} assentos ({livres}{" "}
        {livres === 1 ? "livre" : "livres"}).
      </p>

      <h3>Pessoas</h3>
      <ul className="lista">
        {membros.map((m) => (
          <li key={m.user_id}>
            <span>
              {m.nome} · {m.email} · {ROTULO_PAPEL[m.role] ?? m.role}
              {m.status !== "ativo" && ` · ${ROTULO_STATUS[m.status]}`}
            </span>
            {geridoPeloAdm(m.role) && m.user_id !== euId && (
              <>
                <AcaoForm
                  action={alterarPapel}
                  campos={{ orgId: empresa.id, userId: m.user_id }}
                  rotulo="Trocar papel"
                  rotuloEnviando="Salvando…"
                  variante="secundario"
                >
                  <label className="sr-only" htmlFor={`papel-${empresa.id}-${m.user_id}`}>
                    Papel de {m.nome}
                  </label>
                  <select id={`papel-${empresa.id}-${m.user_id}`} name="papel" defaultValue={m.role}>
                    {PAPEIS_CONVITE.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL[p]}
                      </option>
                    ))}
                  </select>
                </AcaoForm>
                <AcaoForm
                  action={removerMembro}
                  campos={{ orgId: empresa.id, userId: m.user_id }}
                  rotulo="Remover"
                  rotuloEnviando="Removendo…"
                  variante="secundario"
                />
              </>
            )}
          </li>
        ))}
      </ul>

      {convites.length > 0 && (
        <>
          <h3>Convites pendentes</h3>
          <ul className="lista">
            {convites.map((c) => (
              <li key={c.id}>
                <span>
                  {c.email} · {ROTULO_PAPEL[c.role] ?? c.role} · vale até {data.format(new Date(c.expira_em))}
                </span>
                <AcaoForm
                  action={cancelarConvite}
                  campos={{ conviteId: c.id }}
                  rotulo="Cancelar"
                  rotuloEnviando="Cancelando…"
                  variante="secundario"
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Convidar colega</h3>
      {livres > 0 ? (
        <AcaoForm
          action={convidarMembro}
          campos={{ orgId: empresa.id }}
          rotulo="Enviar convite"
          rotuloEnviando="Enviando…"
          className="acao-form acao-form-coluna"
        >
          <div className="field">
            <label htmlFor={`email-${empresa.id}`}>E-mail corporativo</label>
            <input id={`email-${empresa.id}`} name="email" type="email" autoComplete="off" required maxLength={254} />
          </div>
          <div className="field">
            <label htmlFor={`papel-convite-${empresa.id}`}>Papel</label>
            <select id={`papel-convite-${empresa.id}`} name="papel" defaultValue="rw_cliente">
              {PAPEIS_CONVITE.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAPEL[p]}: {DESCRICAO_PAPEL_CLIENTE[p]}
                </option>
              ))}
            </select>
          </div>
        </AcaoForm>
      ) : (
        <p className="notice">Todos os assentos estão em uso. Para ampliar, fale com a equipe IRON AI.</p>
      )}
      <p className="field-hint">O convite vale por 7 dias. A pessoa entra com o papel escolhido e só passa a ter acesso depois de aceitar. Para tornar alguém ADM-Cliente, fale com a equipe IRON AI.</p>
    </section>
  );
}

export default async function EmpresaPage() {
  const perfil = await exigirContaAtiva();
  const sessao = await getSessao();
  const empresas = sessao?.gestorDe ?? [];
  if (empresas.length === 0) notFound();

  return (
    <main>
      <p className="eyebrow">Minha empresa</p>
      <h1 className="title">Pessoas e convites</h1>
      {empresas.map((orgId) => (
        <SecaoEmpresa key={orgId} orgId={orgId} euId={perfil.id} />
      ))}
    </main>
  );
}
