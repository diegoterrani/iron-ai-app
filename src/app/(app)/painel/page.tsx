import type { Metadata } from "next";
import Link from "next/link";
import { ConvitesPendentes } from "@/components/convites-pendentes";
import { podeUsarBackoffice } from "@/lib/auth/admin";
import { eAnalistaDeep } from "@/lib/auth/deep";
import { eGestorDeEmpresa } from "@/lib/auth/empresa";
import { exigirContaAtiva, getSessao } from "@/lib/auth/session";
import { aprofundamentoParaProgresso, eFormato06, montarQuestionario06 } from "@/lib/assessment/v06/self";
import { progresso06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import type { EmpresaSelf } from "@/lib/assessment/questionario";
import { createClient } from "@/lib/supabase/server";
import { CONTATO_URL, DURACAO_SELF } from "@/lib/ui/textos";

export const metadata: Metadata = { title: "Painel" };

interface LinhaSelf {
  id: string;
  org_id: string | null;
  status: "rascunho" | "concluido";
  respostas: unknown;
  empresa: EmpresaSelf | null;
  atualizado_em: string;
  concluido_em: string | null;
}

const dataCurta = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

/** "passo X de Y" do Self 0.6; rascunhos antigos (0.5) não têm passos. */
function passos(l: LinhaSelf): string | null {
  if (!eFormato06(l.respostas)) return null;
  const r = (l.respostas ?? {}) as Rascunho06;
  const p = progresso06(montarQuestionario06(), r, l.empresa ?? {}, aprofundamentoParaProgresso(r));
  return `passo ${p.feitos} de ${p.total}`;
}

/**
 * Painel: o que a pessoa tem para fazer agora, conforme o perfil. Self (seu e
 * das empresas em que participa ou que atende), Deeps em andamento para a
 * equipe, cadastros aguardando para o super-admin e Minha empresa para o ADM.
 * Cada consulta passa pelo RLS; a tela só escolhe o que mostrar.
 */
export default async function PainelPage() {
  const perfil = await exigirContaAtiva();
  const sessao = await getSessao();
  const [admin, gestor, analista] = await Promise.all([podeUsarBackoffice(), eGestorDeEmpresa(), eAnalistaDeep()]);
  const idsEmpresas = [...new Set([...(sessao?.vinculos ?? []).map((v) => v.orgId), ...(sessao?.atendidas ?? [])])];

  const supabase = await createClient();
  const campos = "id, org_id, status, respostas, empresa, atualizado_em, concluido_em";
  const [pessoaisRes, daEmpresaRes, direitoRes, orgsRes, deepsRes, contadoresRes] = await Promise.all([
    supabase.from("assessments").select(campos).eq("user_id", perfil.id).is("org_id", null).order("atualizado_em", { ascending: false }).limit(5),
    idsEmpresas.length > 0
      ? supabase.from("assessments").select(campos).in("org_id", idsEmpresas).order("atualizado_em", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as LinhaSelf[] }),
    supabase.rpc("tem_direito", { p_produto: "self_assessment" }),
    idsEmpresas.length > 0
      ? supabase.from("organizations").select("id, nome").in("id", idsEmpresas)
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    analista
      ? supabase.from("deep_assessments").select("id", { count: "exact", head: true }).eq("status", "em_andamento")
      : Promise.resolve({ count: null }),
    admin ? supabase.rpc("admin_contadores").maybeSingle<{ pendentes: number }>() : Promise.resolve({ data: null }),
  ]);

  const nomeOrg = new Map(((orgsRes.data ?? []) as { id: string; nome: string }[]).map((o) => [o.id, o.nome]));
  const linhas = [...((pessoaisRes.data ?? []) as LinhaSelf[]), ...((daEmpresaRes.data ?? []) as LinhaSelf[])].sort((a, b) =>
    b.atualizado_em.localeCompare(a.atualizado_em),
  );
  const rascunhos = linhas.filter((l) => l.status === "rascunho").slice(0, 3);
  const concluido = linhas.find((l) => l.status === "concluido");
  const nomeDe = (l: LinhaSelf) => (l.org_id ? nomeOrg.get(l.org_id) : null) ?? l.empresa?.nome ?? "Assessment pessoal";
  // RO-Cliente só acompanha o rascunho da empresa.
  const soLeitura = new Set((sessao?.vinculos ?? []).filter((v) => v.role === "ro_cliente").map((v) => v.orgId));
  const temDireitoPessoal = direitoRes.data === true;
  const podeComecar = temDireitoPessoal || idsEmpresas.length > 0;
  const deepsEmAndamento = deepsRes.count ?? 0;
  const pendentes = contadoresRes.data?.pendentes ?? 0;

  return (
    <main>
      <p className="eyebrow">Painel</p>
      <h1 className="title">Olá, {perfil.nome}.</h1>
      <p className="lead">O que você tem para fazer agora.</p>

      <ConvitesPendentes />

      <ul className="stats painel-cartoes">
        {rascunhos.map((l) => {
          const p = passos(l);
          return (
            <li key={l.id}>
              <Link href={`/assessment/${l.id}`}>
                <strong>{l.org_id && soLeitura.has(l.org_id) ? "Acompanhar Self" : "Continuar Self"}</strong>
                {nomeDe(l)}
                {p ? ` · ${p}` : ""}
                <span className="painel-detalhe">alterado em {dataCurta.format(new Date(l.atualizado_em))}</span>
              </Link>
            </li>
          );
        })}

        {concluido && (
          <li>
            <Link href={`/assessment/${concluido.id}/resultado`}>
              <strong>Ver resultado</strong>
              Self de {nomeDe(concluido)}
              <span className="painel-detalhe">concluído em {dataCurta.format(new Date(concluido.concluido_em ?? concluido.atualizado_em))}</span>
            </Link>
          </li>
        )}

        {rascunhos.length === 0 && (
          <li>
            {podeComecar ? (
              <Link href="/assessment">
                <strong>Self assessment</strong>
                Quanto lucro a empresa deixa na mesa com processos que a IA ajuda, em {DURACAO_SELF}.
              </Link>
            ) : (
              <a href={CONTATO_URL}>
                <strong>Self assessment</strong>
                Ainda não liberado para você. Fale com a equipe IRON AI para contratar.
              </a>
            )}
          </li>
        )}

        {analista && (
          <li>
            <Link href="/deep">
              <strong>{deepsEmAndamento}</strong>
              {deepsEmAndamento === 1 ? "Deep em andamento" : "Deeps em andamento"}
            </Link>
          </li>
        )}

        {admin && (
          <li>
            <Link href="/admin/usuarios?status=pendente">
              <strong>{pendentes}</strong>
              {pendentes === 1 ? "cadastro aguardando aprovação" : "cadastros aguardando aprovação"}
            </Link>
          </li>
        )}

        {(gestor || idsEmpresas.length > 0 || admin) && (
          <li>
            <Link href="/empresas">
              <strong>{idsEmpresas.length > 1 || admin ? "Empresas" : "Minha empresa"}</strong>
              Cadastro, pessoas, Self, Deep e resumo da empresa.
            </Link>
          </li>
        )}
      </ul>
    </main>
  );
}
