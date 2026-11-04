import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resumoAuditoria, type LinhaAuditoria } from "@/lib/admin/auditoria";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { PAPEIS_GLOBAIS, PRODUTOS, ROTULO_PAPEL, ROTULO_PRODUTO, ROTULO_STATUS, idValido, type Status } from "@/lib/validation/admin";
import { AcaoForm } from "@/components/acao-form";
import {
  atribuirStaff,
  concederDireito,
  concederPapel,
  definirStatus,
  desvincularEmpresa,
  removerAssessment,
  revogarDireito,
  revogarPapel,
  transferirAssessment,
} from "../../actions";
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
  const [fichaRes, papeisRes, vinculosRes, staffRes, empresasRes, auditoriaRes, direitosRes, assessmentsRes] = await Promise.all([
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
    supabase
      .from("direitos")
      .select("produto, origem, concedido_em")
      .eq("user_id", id)
      .is("revogado_em", null),
    // RLS: super-admin lê os assessments de qualquer pessoa (só status e datas aqui).
    supabase
      .from("assessments")
      .select("id, org_id, setor, status, criado_em, concluido_em")
      .eq("user_id", id)
      .order("criado_em", { ascending: false })
      .limit(50),
  ]);

  const ficha = fichaRes.data;
  if (!ficha) notFound();

  const souEu = ficha.id === eu.id;
  const papeis = (papeisRes.data ?? []).map((p) => p.role as string);
  const vinculos = (vinculosRes.data ?? []) as unknown as { org_id: string; role: string; organizations: Empresa | null }[];
  const atribuicoes = (staffRes.data ?? []) as unknown as { org_id: string; organizations: Empresa | null }[];
  const empresas = (empresasRes.data ?? []) as Empresa[];
  const auditoria = (auditoriaRes.data ?? []) as LinhaAuditoria[];
  const direitos = (direitosRes.data ?? []) as { produto: string; origem: string; concedido_em: string }[];
  const assessments = (assessmentsRes.data ?? []) as {
    id: string;
    org_id: string | null;
    setor: string;
    status: "rascunho" | "concluido";
    criado_em: string;
    concluido_em: string | null;
  }[];
  const ehStaff = papeis.some((p) => p === "equipe_iron" || p === "parceiro");
  const naoAtribuidas = empresas.filter((e) => !atribuicoes.some((a) => a.org_id === e.id));
  // Destino possível de um Self pessoal: empresas em que a pessoa é ADM ou RW (o banco confere).
  const destinos = vinculos.filter((v) => v.role === "adm_cliente" || v.role === "rw_cliente");
  const nomeEmpresa = (orgId: string) =>
    vinculos.find((v) => v.org_id === orgId)?.organizations?.nome ?? empresas.find((e) => e.id === orgId)?.nome ?? "empresa";

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

      <section className="secao" aria-labelledby="sec-produtos">
        <h2 id="sec-produtos">Produtos liberados</h2>
        <ul className="lista">
          {PRODUTOS.map((p) => {
            const ativo = direitos.find((d) => d.produto === p);
            return (
              <li key={p}>
                <span>
                  {ROTULO_PRODUTO[p]} ·{" "}
                  {ativo
                    ? `liberado em ${formatarDataHora(ativo.concedido_em)}${ativo.origem === "stripe" ? " (pagamento)" : ""}`
                    : "não liberado"}
                </span>
                {ativo ? (
                  <AcaoForm
                    action={revogarDireito}
                    campos={{ userId: ficha.id, produto: p }}
                    rotulo="Revogar"
                    rotuloEnviando="Revogando…"
                    variante="secundario"
                  />
                ) : (
                  <AcaoForm
                    action={concederDireito}
                    campos={{ userId: ficha.id, produto: p }}
                    rotulo="Liberar"
                    rotuloEnviando="Liberando…"
                  />
                )}
              </li>
            );
          })}
        </ul>
        <p className="field-hint">Enquanto o pagamento não está no ar, a liberação é manual. A pessoa precisa estar com a conta ativa para usar.</p>
      </section>

      <section className="secao" aria-labelledby="sec-assessments">
        <h2 id="sec-assessments">Assessments</h2>
        {assessments.length === 0 ? (
          <p className="field-hint">Nenhum assessment.</p>
        ) : (
          <ul className="lista">
            {assessments.map((a) => (
              <li key={a.id}>
                <span>
                  Self · {a.org_id ? `da empresa ${nomeEmpresa(a.org_id)}` : "pessoal"} ·{" "}
                  {a.status === "concluido"
                    ? `concluído em ${formatarDataHora(a.concluido_em ?? a.criado_em)}`
                    : `rascunho iniciado em ${formatarDataHora(a.criado_em)}`}
                </span>
                {!a.org_id && destinos.length > 0 && (
                  <AcaoForm
                    action={transferirAssessment}
                    campos={{ assessmentId: a.id }}
                    rotulo="Transferir para a empresa"
                    rotuloEnviando="Transferindo…"
                    variante="secundario"
                    className="acao-form acao-form-coluna"
                  >
                    <div className="field">
                      <label htmlFor={`destino-${a.id}`}>Empresa</label>
                      <select id={`destino-${a.id}`} name="orgId" defaultValue={destinos[0].org_id}>
                        {destinos.map((v) => (
                          <option key={v.org_id} value={v.org_id}>
                            {v.organizations?.nome ?? "Empresa"} ({ROTULO_PAPEL[v.role] ?? v.role})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`motivo-transf-${a.id}`}>Motivo (vai para a auditoria)</label>
                      <input id={`motivo-transf-${a.id}`} name="motivo" type="text" minLength={5} maxLength={300} required />
                    </div>
                  </AcaoForm>
                )}
                <AcaoForm
                  action={removerAssessment}
                  campos={{ assessmentId: a.id }}
                  rotulo="Remover"
                  rotuloEnviando="Removendo…"
                  variante="perigo"
                >
                  <div className="field">
                    <label htmlFor={`motivo-${a.id}`}>Motivo (vai para a auditoria)</label>
                    <input id={`motivo-${a.id}`} name="motivo" type="text" minLength={5} maxLength={300} required />
                  </div>
                </AcaoForm>
              </li>
            ))}
          </ul>
        )}
        <p className="field-hint">
          Remover apaga as respostas, o resultado e a conversa com o assistente, sem volta. Fica só o registro na auditoria.
          Transferir leva um Self pessoal para a empresa em que a pessoa é ADM ou RW-Cliente: as pessoas da empresa passam a
          ver (e, se for rascunho, ADM e RW a editar); a conversa com o assistente continua só da pessoa.
        </p>
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
