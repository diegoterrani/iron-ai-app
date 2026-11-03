import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resumoAuditoria, type LinhaAuditoria } from "@/lib/admin/auditoria";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { PAPEIS_GLOBAIS, ROTULO_PAPEL, ROTULO_STATUS, idValido, type Status } from "@/lib/validation/admin";
import { AcaoForm } from "@/components/acao-form";
import { atribuirStaff, concederPapel, definirStatus, desvincularEmpresa, revogarPapel } from "../../actions";
import { formatarDataHora } from "../../formato";

export const metadata: Metadata = { title: "Usuário" };

interface Ficha {
  id: string;
  nome: string;
  email: string;
  status: Status;
  criado_em: string;
  ultimo_acesso: string | null;
  provedores: string[];
  mfa_ativo: boolean;
  aceite_termos_versao: string | null;
}

interface Empresa {
  id: string;
  nome: string;
}

const PROVEDOR: Record<string, string> = { email: "E-mail e senha", google: "Google", azure: "Microsoft" };

/** Próximas ações de status a partir do status atual. */
const ACOES_STATUS: Record<Status, { status: Status; rotulo: string; variante: "primario" | "perigo" | "secundario" }[]> = {
  pendente: [
    { status: "ativo", rotulo: "Aprovar cadastro", variante: "primario" },
    { status: "suspenso", rotulo: "Recusar (suspender)", variante: "perigo" },
  ],
  ativo: [{ status: "suspenso", rotulo: "Suspender acesso", variante: "perigo" }],
  suspenso: [{ status: "ativo", rotulo: "Reativar", variante: "primario" }],
};

export default async function UsuarioPage({ params }: PageProps<"/admin/usuarios/[id]">) {
  const eu = await exigirSuperAdmin();
  const { id } = await params;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  const [fichaRes, papeisRes, vinculosRes, staffRes, empresasRes, auditoriaRes] = await Promise.all([
    supabase.rpc("admin_obter_usuario", { p_user: id }).maybeSingle<Ficha>(),
    supabase.from("user_roles").select("role, concedido_em").eq("user_id", id),
    supabase.from("memberships").select("org_id, role, organizations(id, nome)").eq("user_id", id),
    supabase.from("staff_assignments").select("org_id, organizations(id, nome)").eq("user_id", id),
    supabase.from("organizations").select("id, nome").order("nome").limit(500),
    supabase
      .from("audit_log")
      .select("id, ator, acao, tabela, alvo, dados, criado_em")
      .eq("alvo", id)
      .order("criado_em", { ascending: false })
      .limit(20),
  ]);

  const ficha = fichaRes.data;
  if (!ficha) notFound();

  const souEu = ficha.id === eu.id;
  const papeis = (papeisRes.data ?? []).map((p) => p.role as string);
  const vinculos = (vinculosRes.data ?? []) as unknown as { org_id: string; role: string; organizations: Empresa | null }[];
  const atribuicoes = (staffRes.data ?? []) as unknown as { org_id: string; organizations: Empresa | null }[];
  const empresas = (empresasRes.data ?? []) as Empresa[];
  const auditoria = (auditoriaRes.data ?? []) as LinhaAuditoria[];
  const ehStaff = papeis.some((p) => p === "equipe_iron" || p === "parceiro");
  const naoAtribuidas = empresas.filter((e) => !atribuicoes.some((a) => a.org_id === e.id));

  return (
    <main>
      <p className="eyebrow">
        <Link href="/admin/usuarios">Usuários</Link> / ficha
      </p>
      <h1 className="title">{ficha.nome}</h1>

      <dl className="ficha">
        <dt>E-mail</dt>
        <dd>{ficha.email}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`selo selo-${ficha.status}`}>{ROTULO_STATUS[ficha.status]}</span>
        </dd>
        <dt>Login por</dt>
        <dd>{ficha.provedores.length ? ficha.provedores.map((p) => PROVEDOR[p] ?? p).join(", ") : "—"}</dd>
        <dt>Verificação em duas etapas</dt>
        <dd>{ficha.mfa_ativo ? "Ativa" : "Não ativada"}</dd>
        <dt>Termos aceitos</dt>
        <dd>{ficha.aceite_termos_versao ?? "Ainda não (entrou por Google/Microsoft)"}</dd>
        <dt>Cadastro</dt>
        <dd>{formatarDataHora(ficha.criado_em)}</dd>
        <dt>Último acesso</dt>
        <dd>{formatarDataHora(ficha.ultimo_acesso)}</dd>
      </dl>

      {souEu && (
        <p className="notice" role="note">
          Esta é a sua conta. Por segurança, ninguém altera o próprio status ou os próprios papéis pela tela.
        </p>
      )}

      <section className="secao" aria-labelledby="sec-status">
        <h2 id="sec-status">Acesso</h2>
        {souEu ? (
          <p className="field-hint">Sem ações disponíveis.</p>
        ) : (
          <div className="acoes">
            {ACOES_STATUS[ficha.status].map((a) => (
              <AcaoForm
                key={a.status}
                action={definirStatus}
                campos={{ userId: ficha.id, status: a.status }}
                rotulo={a.rotulo}
                variante={a.variante}
              />
            ))}
          </div>
        )}
        {ficha.status === "pendente" && papeis.length === 0 && vinculos.length === 0 && (
          <p className="field-hint">Depois de aprovar, conceda um papel abaixo ou vincule a uma empresa.</p>
        )}
      </section>

      <section className="secao" aria-labelledby="sec-papeis">
        <h2 id="sec-papeis">Papéis</h2>
        {papeis.length === 0 ? (
          <p className="field-hint">Nenhum papel global.</p>
        ) : (
          <ul className="lista">
            {papeis.map((p) => (
              <li key={p}>
                <span>{ROTULO_PAPEL[p] ?? p}</span>
                {!souEu && p !== "super_admin" && (
                  <AcaoForm
                    action={revogarPapel}
                    campos={{ userId: ficha.id, papel: p }}
                    rotulo="Revogar"
                    rotuloEnviando="Revogando…"
                    variante="secundario"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {!souEu && PAPEIS_GLOBAIS.some((p) => !papeis.includes(p)) && (
          <AcaoForm action={concederPapel} campos={{ userId: ficha.id }} rotulo="Conceder papel" rotuloEnviando="Concedendo…">
            <div className="field">
              <label htmlFor="papel">Novo papel</label>
              <select id="papel" name="papel" required>
                {PAPEIS_GLOBAIS.filter((p) => !papeis.includes(p)).map((p) => (
                  <option key={p} value={p}>
                    {ROTULO_PAPEL[p]}
                  </option>
                ))}
              </select>
            </div>
          </AcaoForm>
        )}
        <p className="field-hint">Super-admin só é concedido por comando no banco. Equipe IRON precisa ativar MFA no próximo acesso.</p>
      </section>

      <section className="secao" aria-labelledby="sec-empresas">
        <h2 id="sec-empresas">Empresas</h2>
        {vinculos.length === 0 ? (
          <p className="field-hint">Não pertence a nenhuma empresa. Para vincular, abra a empresa em Empresas.</p>
        ) : (
          <ul className="lista">
            {vinculos.map((v) => (
              <li key={v.org_id}>
                <span>
                  <Link href={`/admin/empresas/${v.org_id}`}>{v.organizations?.nome ?? "Empresa"}</Link> · {ROTULO_PAPEL[v.role] ?? v.role}
                </span>
                <AcaoForm
                  action={desvincularEmpresa}
                  campos={{ orgId: v.org_id, userId: ficha.id }}
                  rotulo="Remover"
                  rotuloEnviando="Removendo…"
                  variante="secundario"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {ehStaff && (
        <section className="secao" aria-labelledby="sec-staff">
          <h2 id="sec-staff">Empresas que atende</h2>
          {atribuicoes.length === 0 ? (
            <p className="field-hint">Nenhuma empresa atribuída.</p>
          ) : (
            <ul className="lista">
              {atribuicoes.map((a) => (
                <li key={a.org_id}>
                  <Link href={`/admin/empresas/${a.org_id}`}>{a.organizations?.nome ?? "Empresa"}</Link>
                  <AcaoForm
                    action={atribuirStaff}
                    campos={{ orgId: a.org_id, userId: ficha.id, atribuir: "0" }}
                    rotulo="Remover"
                    rotuloEnviando="Removendo…"
                    variante="secundario"
                  />
                </li>
              ))}
            </ul>
          )}
          {naoAtribuidas.length > 0 && (
            <AcaoForm action={atribuirStaff} campos={{ userId: ficha.id, atribuir: "1" }} rotulo="Atribuir" rotuloEnviando="Atribuindo…">
              <div className="field">
                <label htmlFor="orgId">Empresa</label>
                <select id="orgId" name="orgId" required>
                  {naoAtribuidas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </div>
            </AcaoForm>
          )}
        </section>
      )}

      <section className="secao" aria-labelledby="sec-historico">
        <h2 id="sec-historico">Histórico</h2>
        {auditoria.length === 0 ? (
          <p className="field-hint">Sem registros.</p>
        ) : (
          <ul className="lista lista-historico">
            {auditoria.map((l) => (
              <li key={l.id}>
                <span>{resumoAuditoria(l)}</span>
                <time dateTime={l.criado_em}>{formatarDataHora(l.criado_em)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
