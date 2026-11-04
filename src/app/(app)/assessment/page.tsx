import type { Metadata } from "next";
import Link from "next/link";
import { AcaoForm } from "@/components/acao-form";
import { exigirContaAtiva, getSessao } from "@/lib/auth/session";
import { ROTULO_PAPEL } from "@/lib/validation/admin";
import { createClient } from "@/lib/supabase/server";
import { descartarRascunho, iniciarSelf } from "./actions";

export const metadata: Metadata = { title: "Self assessment" };

interface Linha {
  id: string;
  status: "rascunho" | "concluido";
  criado_em: string;
  concluido_em: string | null;
}

interface LinhaEmpresa extends Linha {
  org_id: string;
}

const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Papéis que respondem e editam o assessment da empresa (a tela só esconde; o banco decide). */
const EDITA = new Set(["adm_cliente", "rw_cliente"]);

function situacao(l: Linha): string {
  return l.status === "concluido"
    ? `concluído em ${data.format(new Date(l.concluido_em ?? l.criado_em))}`
    : `rascunho iniciado em ${data.format(new Date(l.criado_em))}`;
}

/** Assessment da empresa: um rascunho só, que ADM e RW-Cliente editam e RO-Cliente acompanha. */
async function SecaoEmpresa({ orgId, role, nome }: { orgId: string; role: string; nome: string }) {
  const supabase = await createClient();
  const [direitoRes, lista] = await Promise.all([
    supabase.rpc("tem_direito", { p_produto: "self_assessment", p_org: orgId }),
    supabase
      .from("assessments")
      .select("id, org_id, status, criado_em, concluido_em")
      .eq("org_id", orgId)
      .order("criado_em", { ascending: false })
      .limit(20),
  ]);
  const temDireito = direitoRes.data === true;
  const edita = EDITA.has(role);
  const adm = role === "adm_cliente";
  const linhas = (lista.data ?? []) as LinhaEmpresa[];
  const rascunho = linhas.find((l) => l.status === "rascunho");

  return (
    <section className="secao" aria-labelledby={`sec-empresa-${orgId}`}>
      <h2 id={`sec-empresa-${orgId}`}>{nome}</h2>
      <p className="field-hint">
        Seu papel: {ROTULO_PAPEL[role] ?? role}.{" "}
        {edita
          ? "Você e os colegas com permissão de escrita preenchem o mesmo assessment da empresa."
          : "Você acompanha o assessment da empresa em modo leitura."}
      </p>
      {edita &&
        (temDireito ? (
          <AcaoForm
            action={iniciarSelf}
            campos={{ orgId }}
            rotulo={rascunho ? "Continuar o assessment da empresa" : "Começar o assessment da empresa"}
            rotuloEnviando="Abrindo…"
            className="acao-form secao-acao"
          />
        ) : (
          <p className="notice" role="note">
            O Self assessment ainda não está liberado para esta empresa. Fale com a equipe IRON AI para contratar.
          </p>
        ))}
      {linhas.length === 0 ? (
        <p className="field-hint">Nenhum assessment da empresa ainda.</p>
      ) : (
        <ul className="lista">
          {linhas.map((l) => (
            <li key={l.id}>
              <span>Food service · {situacao(l)}</span>
              {l.status === "concluido" ? (
                <Link href={`/assessment/${l.id}/resultado`}>Ver resultado</Link>
              ) : (
                <>
                  {edita && temDireito && <Link href={`/assessment/${l.id}`}>Continuar</Link>}
                  {adm && (
                    <AcaoForm
                      action={descartarRascunho}
                      campos={{ assessmentId: l.id }}
                      rotulo="Descartar rascunho"
                      rotuloEnviando="Descartando…"
                      variante="perigo"
                    >
                      <label className="check">
                        <input type="checkbox" name="confirmar" required />
                        <span>Apagar as respostas da empresa neste rascunho (não dá para desfazer)</span>
                      </label>
                    </AcaoForm>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function AssessmentPage() {
  const perfil = await exigirContaAtiva();
  const sessao = await getSessao();
  const vinculos = sessao?.vinculos ?? [];
  const supabase = await createClient();
  const [direitoRes, lista, empresasRes] = await Promise.all([
    supabase.rpc("tem_direito", { p_produto: "self_assessment" }),
    supabase
      .from("assessments")
      .select("id, status, criado_em, concluido_em")
      .eq("user_id", perfil.id)
      .is("org_id", null)
      .order("criado_em", { ascending: false })
      .limit(20),
    vinculos.length > 0
      ? supabase
          .from("organizations")
          .select("id, nome")
          .in(
            "id",
            vinculos.map((v) => v.orgId),
          )
          .order("nome")
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
  ]);
  const temDireito = direitoRes.data === true;
  const linhas = (lista.data ?? []) as Linha[];
  const rascunho = linhas.find((l) => l.status === "rascunho");
  const empresas = (empresasRes.data ?? []) as { id: string; nome: string }[];
  const papelEm = new Map(vinculos.map((v) => [v.orgId, v.role]));

  return (
    <main>
      <p className="eyebrow">Assessments</p>
      <h1 className="title">Self assessment</h1>
      <p className="lead">
        Em cerca de 12 minutos, você responde 16 perguntas sobre a operação e recebe o score de sucesso na
        implantação de IA, o retorno anual conservador em R$ e o mapa de dados da empresa.
      </p>
      <p className="field-hint">
        Não peça nem informe dados pessoais de clientes ou funcionários. O assessment pessoal fica visível só para você;
        o da empresa, para as pessoas que ela autorizar.
      </p>

      {empresas.map((e) => (
        <SecaoEmpresa key={e.id} orgId={e.id} nome={e.nome} role={papelEm.get(e.id) ?? ""} />
      ))}

      {(temDireito || linhas.length > 0 || empresas.length === 0) && (
        <section className="secao" aria-labelledby={empresas.length > 0 ? "sec-pessoal" : undefined}>
          {empresas.length > 0 && <h2 id="sec-pessoal">Assessment pessoal</h2>}
          {temDireito ? (
            <AcaoForm
              action={iniciarSelf}
              rotulo={rascunho ? "Continuar de onde parei" : "Começar"}
              rotuloEnviando="Abrindo…"
              className="acao-form secao-acao"
            />
          ) : (
            empresas.length === 0 && (
              <p className="notice" role="note">
                Seu acesso ao Self assessment ainda não está liberado. Fale com a equipe IRON AI para contratar.
              </p>
            )
          )}

          {linhas.length > 0 && (
            <>
              <h3 id="sec-historico">Seus assessments</h3>
              <ul className="lista">
                {linhas.map((l) => (
                  <li key={l.id}>
                    <span>Food service · {situacao(l)}</span>
                    {l.status === "concluido" ? (
                      <Link href={`/assessment/${l.id}/resultado`}>Ver resultado</Link>
                    ) : (
                      <>
                        {temDireito && <Link href={`/assessment/${l.id}`}>Continuar</Link>}
                        <AcaoForm
                          action={descartarRascunho}
                          campos={{ assessmentId: l.id }}
                          rotulo="Descartar rascunho"
                          rotuloEnviando="Descartando…"
                          variante="perigo"
                        >
                          <label className="check">
                            <input type="checkbox" name="confirmar" required />
                            <span>Apagar as respostas deste rascunho (não dá para desfazer)</span>
                          </label>
                        </AcaoForm>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
