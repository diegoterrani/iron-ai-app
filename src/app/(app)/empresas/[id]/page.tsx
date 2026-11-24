import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirContaAtiva, getSessao } from "@/lib/auth/session";
import { ROTULO_VEREDITO, resumoResultado } from "@/lib/empresa/area";
import { createClient } from "@/lib/supabase/server";
import { ROTULO_PAPEL, ROTULO_STATUS, idValido, type Status } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "Área da empresa" };

interface Empresa {
  id: string;
  nome: string;
  cnpj: string | null;
  assentos: number;
  created_at: string;
}

interface Self {
  id: string;
  status: "rascunho" | "concluido";
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
}

interface Deep {
  id: string;
  status: "em_andamento" | "concluido" | "cancelado";
  criado_em: string;
  concluido_em: string | null;
}

interface Pessoa {
  user_id: string;
  nome: string;
  email?: string;
  role: string;
  status: Status;
}

const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const dataDe = (v: string | null | undefined) => (v ? data.format(new Date(v)) : "—");
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const ROTULO_DEEP: Record<Deep["status"], string> = { em_andamento: "em andamento", concluido: "concluído", cancelado: "cancelado" };

function cnpjFormatado(cnpj: string | null): string {
  if (!cnpj || !/^\d{14}$/.test(cnpj)) return "—";
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Área da empresa: cadastro, pessoas, Self, Deep e o resumo de uma empresa
 * numa página só. Cada leitura usa a sessão de quem abriu, então o RLS
 * decide o que cada perfil vê (ADM, RW e RO-Cliente veem a própria empresa;
 * Equipe IRON, as que atende; super-admin, todas). Empresa que a pessoa não
 * pode ver dá 404, sem confirmar que existe.
 */
export default async function AreaEmpresaPage({ params }: PageProps<"/empresas/[id]">) {
  await exigirContaAtiva();
  const { id } = await params;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  const { data: empresa } = await supabase
    .from("organizations")
    .select("id, nome, cnpj, assentos, created_at")
    .eq("id", id)
    .maybeSingle<Empresa>();
  if (!empresa) notFound();

  const sessao = await getSessao();
  const meuPapel = sessao?.vinculos.find((v) => v.orgId === id)?.role ?? null;
  const superAdmin = (sessao?.papeis ?? []).includes("super_admin");

  const [selfsRes, deepsRes, direitoRes, usaSelfRes, gereRes, analistaRes, relatoriosRes] = await Promise.all([
    supabase
      .from("assessments")
      .select("id, status, criado_em, atualizado_em, concluido_em")
      .eq("org_id", id)
      .order("criado_em", { ascending: false })
      .limit(20),
    supabase.from("deep_assessments").select("id, status, criado_em, concluido_em").eq("org_id", id).order("criado_em", { ascending: false }),
    supabase.from("direitos").select("produto").eq("org_id", id).is("revogado_em", null),
    // Equipe IRON não lê a tabela de acessos da empresa; o banco diz se o Self vale aqui.
    supabase.rpc("tem_direito", { p_produto: "self_assessment", p_org: id }),
    supabase.rpc("tem_permissao", { p_permissao: "empresa.membros", p_org: id }),
    supabase.rpc("tem_permissao", { p_permissao: "deep.conduzir", p_org: id }),
    supabase.rpc("tem_permissao", { p_permissao: "deep.relatorio_ver", p_org: id }),
  ]);
  const selfs = (selfsRes.data ?? []) as Self[];
  const deeps = (deepsRes.data ?? []) as Deep[];
  const selfLiberado = (direitoRes.data ?? []).some((d) => d.produto === "self_assessment") || usaSelfRes.data === true;
  const gerePessoas = gereRes.data === true;
  const conduzDeep = analistaRes.data === true;
  const leRelatorios = relatoriosRes.data === true;

  // Resultado mais recente do último Self concluído (RLS: quem vê o assessment lê).
  const concluido = selfs.find((s) => s.status === "concluido") ?? null;
  const rascunho = selfs.find((s) => s.status === "rascunho") ?? null;
  const [resultadoRes, pessoas, sessoesRes, publicadosRes] = await Promise.all([
    concluido
      ? supabase
          .from("assessment_resultados")
          .select("resultado")
          .eq("assessment_id", concluido.id)
          .order("criado_em", { ascending: false })
          .limit(1)
          .maybeSingle<{ resultado: unknown }>()
      : Promise.resolve({ data: null }),
    carregarPessoas(supabase, id, gerePessoas, superAdmin),
    conduzDeep && deeps.length > 0
      ? supabase.from("deep_sessoes").select("id", { count: "exact", head: true }).in("deep_id", deeps.map((d) => d.id))
      : Promise.resolve({ count: null }),
    deeps.length > 0 && (conduzDeep || leRelatorios)
      ? supabase
          .from("deep_relatorios")
          .select("id", { count: "exact", head: true })
          .in("deep_id", deeps.map((d) => d.id))
          .not("publicado_em", "is", null)
      : Promise.resolve({ count: null }),
  ]);
  const resumo = resumoResultado(resultadoRes.data?.resultado ?? null);
  const deepAtual = deeps.find((d) => d.status === "em_andamento") ?? deeps[0] ?? null;
  const reunioes = sessoesRes.count ?? 0;
  const publicados = publicadosRes.count ?? 0;

  return (
    <main className="area-empresa">
      <p className="eyebrow">
        <Link href="/empresas">Empresas</Link> / área da empresa
      </p>
      <h1 className="title">{empresa.nome}</h1>
      <p className="lead">
        {meuPapel ? `Você é ${ROTULO_PAPEL[meuPapel] ?? meuPapel} nesta empresa.` : superAdmin ? "Você vê como super-admin." : "Você atende esta empresa pela IRON AI."}
      </p>

      <nav className="area-empresa-nav" aria-label="Seções da empresa">
        <a href="#resumo">Resumo</a>
        <a href="#cadastro">Cadastro</a>
        <a href="#pessoas">Pessoas</a>
        <a href="#self">Self assessment</a>
        <a href="#deep">Deep assessment</a>
      </nav>

      <section className="secao" id="resumo" aria-labelledby="sec-resumo">
        <h2 id="sec-resumo">Resumo</h2>
        <ul className="stats painel-cartoes">
          <li>
            {concluido ? (
              <Link href={`/assessment/${concluido.id}/resultado`}>
                <strong>{resumo ? `${numero.format(resumo.retorno)}×` : "Self concluído"}</strong>
                {resumo ? `Retorno em 24 meses · ${ROTULO_VEREDITO[resumo.veredito] ?? resumo.veredito}` : "Ver o resultado"}
                <span className="painel-detalhe">Self concluído em {dataDe(concluido.concluido_em)}</span>
              </Link>
            ) : (
              <Link href="/assessment">
                <strong>Self assessment</strong>
                {rascunho ? "Em andamento" : selfLiberado ? "Liberado, ainda não iniciado" : "Ainda não liberado"}
              </Link>
            )}
          </li>
          <li>
            {deepAtual && conduzDeep ? (
              <Link href={`/deep/${deepAtual.id}`}>
                <strong>Deep {ROTULO_DEEP[deepAtual.status]}</strong>
                {reunioes} {reunioes === 1 ? "reunião" : "reuniões"} · {publicados} {publicados === 1 ? "relatório publicado" : "relatórios publicados"}
                <span className="painel-detalhe">aberto em {dataDe(deepAtual.criado_em)}</span>
              </Link>
            ) : (
              <span className="painel-cartao-estatico">
                <strong>Deep assessment</strong>
                {deeps.length > 0 || publicados > 0
                  ? `${publicados} ${publicados === 1 ? "relatório publicado" : "relatórios publicados"}`
                  : "Ainda não iniciado"}
              </span>
            )}
          </li>
          <li>
            <span className="painel-cartao-estatico">
              <strong>{pessoas ? pessoas.length : "—"}</strong>
              {`${pessoas && pessoas.length === 1 ? "pessoa" : "pessoas"} de ${empresa.assentos} assentos`}
            </span>
          </li>
        </ul>
      </section>

      <section className="secao" id="cadastro" aria-labelledby="sec-cadastro">
        <h2 id="sec-cadastro">Cadastro</h2>
        <dl className="ficha">
          <dt>Razão social</dt>
          <dd>{empresa.nome}</dd>
          <dt>CNPJ</dt>
          <dd>{cnpjFormatado(empresa.cnpj)}</dd>
          <dt>Assentos</dt>
          <dd>{empresa.assentos}</dd>
          <dt>Self assessment</dt>
          <dd>{selfLiberado ? "Liberado" : "Não liberado"}</dd>
          <dt>Cliente desde</dt>
          <dd>{dataDe(empresa.created_at)}</dd>
        </dl>
        {superAdmin && (
          <p>
            <Link className="btn btn-inline btn-secondary" href={`/admin/empresas/${empresa.id}`}>
              Editar no backoffice (assentos, acessos, equipe, excluir empresa)
            </Link>
          </p>
        )}
      </section>

      <section className="secao" id="pessoas" aria-labelledby="sec-pessoas">
        <h2 id="sec-pessoas">Pessoas</h2>
        {pessoas === null ? (
          <p className="field-hint">A lista de pessoas aparece para o ADM-Cliente e para o super-admin.</p>
        ) : pessoas.length === 0 ? (
          <p className="field-hint">Ninguém vinculado ainda.</p>
        ) : (
          <ul className="lista">
            {pessoas.map((p) => (
              <li key={p.user_id}>
                <span>
                  {superAdmin ? <Link href={`/admin/usuarios/${p.user_id}`}>{p.nome}</Link> : p.nome}
                  {p.email ? ` · ${p.email}` : ""} · {ROTULO_PAPEL[p.role] ?? p.role}
                  {p.status !== "ativo" && ` · ${ROTULO_STATUS[p.status] ?? p.status}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {gerePessoas && meuPapel === "adm_cliente" && (
          <p>
            <Link className="btn btn-inline btn-secondary" href="/empresa">
              Convidar, trocar papel ou remover pessoas
            </Link>
          </p>
        )}
        {superAdmin && (
          <p className="field-hint">Vincular ou remover pessoas: na ficha da empresa no backoffice. Excluir a conta: na ficha do usuário.</p>
        )}
      </section>

      <section className="secao" id="self" aria-labelledby="sec-self">
        <h2 id="sec-self">Self assessment</h2>
        {selfs.length === 0 ? (
          <p className="field-hint">
            {selfLiberado ? "Nenhum Self da empresa ainda." : "O Self da empresa ainda não foi liberado."}
          </p>
        ) : (
          <ul className="lista">
            {selfs.map((s) => (
              <li key={s.id}>
                <span>
                  {s.status === "concluido" ? `Concluído em ${dataDe(s.concluido_em)}` : `Em andamento · alterado em ${dataDe(s.atualizado_em)}`}
                </span>
                <Link href={s.status === "concluido" ? `/assessment/${s.id}/resultado` : `/assessment/${s.id}`}>
                  {s.status === "concluido" ? "Ver resultado" : "Abrir"}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link className="btn btn-inline btn-secondary" href="/assessment">
            Ir para o Self assessment
          </Link>
        </p>
      </section>

      <section className="secao" id="deep" aria-labelledby="sec-deep">
        <h2 id="sec-deep">Deep assessment</h2>
        {conduzDeep ? (
          deeps.length === 0 ? (
            <p className="field-hint">
              Nenhum Deep aberto. <Link href="/deep">Abrir um Deep</Link>
            </p>
          ) : (
            <ul className="lista">
              {deeps.map((d) => (
                <li key={d.id}>
                  <span>
                    {ROTULO_DEEP[d.status]} · aberto em {dataDe(d.criado_em)}
                    {d.concluido_em ? ` · concluído em ${dataDe(d.concluido_em)}` : ""}
                  </span>
                  <Link href={`/deep/${d.id}`}>Abrir</Link>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="field-hint">
            {publicados > 0
              ? `${publicados} ${publicados === 1 ? "relatório do Deep publicado" : "relatórios do Deep publicados"} pela equipe IRON AI.`
              : "Os relatórios do Deep aparecem aqui quando a equipe IRON AI publicar."}
          </p>
        )}
      </section>
    </main>
  );
}

/**
 * Pessoas da empresa. ADM-Cliente: função empresa_listar_membros (com
 * e-mail). Super-admin: vínculos com o nome (o e-mail fica na ficha).
 * Demais perfis: null (o RLS só devolveria o próprio vínculo).
 */
async function carregarPessoas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  gerePessoas: boolean,
  superAdmin: boolean,
): Promise<Pessoa[] | null> {
  if (gerePessoas && !superAdmin) {
    const { data, error } = await supabase.rpc("empresa_listar_membros", { p_org: orgId });
    return error ? null : ((data ?? []) as Pessoa[]);
  }
  if (superAdmin) {
    const { data, error } = await supabase
      .from("memberships")
      .select("user_id, role, profiles!memberships_user_id_fkey(nome, status)")
      .eq("org_id", orgId)
      .order("role");
    if (error) return null;
    return ((data ?? []) as unknown as { user_id: string; role: string; profiles: { nome: string; status: Status } | null }[]).map(
      (m) => ({ user_id: m.user_id, role: m.role, nome: m.profiles?.nome ?? "Usuário", status: m.profiles?.status ?? "ativo" }),
    );
  }
  return null;
}
