import type { Metadata } from "next";
import Link from "next/link";
import { AcaoForm } from "@/components/acao-form";
import { exigirContaAtiva, getSessao } from "@/lib/auth/session";
import { ROTULO_PAPEL } from "@/lib/validation/admin";
import { createClient } from "@/lib/supabase/server";
import { CONTATO_URL, DURACAO_SELF } from "@/lib/ui/textos";
import { descartarRascunho, iniciarSelf } from "./actions";

export const metadata: Metadata = { title: "Self assessment" };

interface Linha {
  id: string;
  status: "rascunho" | "concluido";
  criado_em: string;
  concluido_em: string | null;
  empresa: { nome?: string } | null;
}

const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Papéis de cliente que respondem e editam o assessment da empresa (a tela só esconde; o banco decide). */
const EDITA = new Set(["adm_cliente", "rw_cliente"]);
/** Papéis globais da IRON que podem responder pela empresa que atendem (com MFA). */
const STAFF = new Set(["super_admin", "equipe_iron"]);

function situacao(l: Linha): string {
  return l.status === "concluido"
    ? `concluído em ${data.format(new Date(l.concluido_em ?? l.criado_em))}`
    : `rascunho iniciado em ${data.format(new Date(l.criado_em))}`;
}

/** Descartar fica recolhido: não disputa atenção com "Continuar" e pede confirmação. */
function Descartar({ id, texto }: { id: string; texto: string }) {
  return (
    <details className="mais-opcoes">
      <summary>Mais opções</summary>
      <AcaoForm
        action={descartarRascunho}
        campos={{ assessmentId: id }}
        rotulo="Descartar rascunho"
        rotuloEnviando="Descartando…"
        variante="perigo"
      >
        <label className="check">
          <input type="checkbox" name="confirmar" required />
          <span>{texto}</span>
        </label>
      </AcaoForm>
    </details>
  );
}

/**
 * Assessment da empresa: um rascunho só, que ADM e RW-Cliente editam e
 * RO-Cliente acompanha. A Equipe IRON atribuída à empresa também responde
 * (conduz o Self com o cliente); o banco confere a permissão e o MFA.
 */
async function SecaoEmpresa({ orgId, nome, papel, atende }: { orgId: string; nome: string; papel: string | null; atende: boolean }) {
  const supabase = await createClient();
  const [direitoRes, lista, editaRes] = await Promise.all([
    supabase.rpc("tem_direito", { p_produto: "self_assessment", p_org: orgId }),
    supabase
      .from("assessments")
      .select("id, status, criado_em, concluido_em, empresa")
      .eq("org_id", orgId)
      .order("criado_em", { ascending: false })
      .limit(20),
    // Quem só atende a empresa (sem papel nela): o banco diz se pode editar.
    papel === null ? supabase.rpc("tem_permissao", { p_permissao: "assessment.editar", p_org: orgId }) : Promise.resolve({ data: null }),
  ]);
  const temDireito = direitoRes.data === true;
  const edita = papel !== null ? EDITA.has(papel) : editaRes.data === true;
  const adm = papel === "adm_cliente";
  const linhas = (lista.data ?? []) as Linha[];
  const rascunho = linhas.find((l) => l.status === "rascunho");

  const quem =
    papel !== null
      ? `Seu papel: ${ROTULO_PAPEL[papel] ?? papel}.`
      : atende
        ? "Você atende esta empresa pela IRON AI."
        : "";
  const explicacao = edita
    ? papel === null
      ? "Você conduz o assessment com o cliente; ele vê o resultado na área da empresa."
      : "Você e os colegas com permissão de escrita preenchem o mesmo assessment da empresa."
    : "Você acompanha o assessment da empresa em modo leitura.";

  return (
    <section className="secao" aria-labelledby={`sec-empresa-${orgId}`}>
      <h2 id={`sec-empresa-${orgId}`}>{nome}</h2>
      <p className="field-hint">
        {quem} {explicacao}
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
        ) : papel === null ? (
          <p className="notice" role="note">
            O Self assessment não está liberado para esta empresa. Libere em Backoffice, na ficha da empresa (Acessos da empresa).
          </p>
        ) : (
          <p className="notice" role="note">
            O Self assessment ainda não está liberado para esta empresa. <a href={CONTATO_URL}>Fale com a equipe IRON AI</a> para
            contratar.
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
                <span className="acoes">
                  {edita ? (
                    temDireito && <Link href={`/assessment/${l.id}`}>Continuar</Link>
                  ) : (
                    <Link href={`/assessment/${l.id}`}>Acompanhar</Link>
                  )}
                  {adm && <Descartar id={l.id} texto="Apagar as respostas da empresa neste rascunho (não dá para desfazer)" />}
                </span>
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
  const atendidas = sessao?.atendidas ?? [];
  const eStaff = (sessao?.papeis ?? []).some((p) => STAFF.has(p));
  const papelEm = new Map(vinculos.map((v) => [v.orgId, v.role]));
  const idsEmpresas = [...new Set([...vinculos.map((v) => v.orgId), ...atendidas])];

  const supabase = await createClient();
  const [direitoRes, lista, empresasRes] = await Promise.all([
    supabase.rpc("tem_direito", { p_produto: "self_assessment" }),
    supabase
      .from("assessments")
      .select("id, status, criado_em, concluido_em, empresa")
      .eq("user_id", perfil.id)
      .is("org_id", null)
      .order("criado_em", { ascending: false })
      .limit(20),
    idsEmpresas.length > 0
      ? supabase.from("organizations").select("id, nome").in("id", idsEmpresas).order("nome")
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
  ]);
  const temDireito = direitoRes.data === true;
  const linhas = (lista.data ?? []) as Linha[];
  const rascunho = linhas.find((l) => l.status === "rascunho");
  const empresas = (empresasRes.data ?? []) as { id: string; nome: string }[];
  const atendidasSet = new Set(atendidas);

  return (
    <main>
      <p className="eyebrow">Assessments</p>
      <h1 className="title">Self assessment</h1>
      <p className="lead">
        Em {DURACAO_SELF}, você responde perguntas rápidas sobre a operação e recebe quanto lucro a empresa deixa na mesa
        com processos que a IA ajuda, o que já está medido e o que o Deep vai medir, e um ganho rápido de 6 semanas.
      </p>
      <p className="field-hint">
        Não peça nem informe dados pessoais de clientes ou funcionários. O assessment pessoal fica visível só para você;
        o da empresa, para as pessoas que ela autorizar.
      </p>

      {empresas.map((e) => (
        <SecaoEmpresa key={e.id} orgId={e.id} nome={e.nome} papel={papelEm.get(e.id) ?? null} atende={atendidasSet.has(e.id)} />
      ))}

      {eStaff && atendidas.length === 0 && (
        <p className="field-hint">
          Para conduzir o Self de um cliente no nome da empresa dele, atribua-se à empresa em Backoffice (ficha do usuário,
          &ldquo;Empresas que atende&rdquo;).
        </p>
      )}

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
                Seu acesso ao Self assessment ainda não está liberado. <a href={CONTATO_URL}>Fale com a equipe IRON AI</a> para
                contratar.
              </p>
            )
          )}

          {linhas.length > 0 && (
            <>
              <h3 id="sec-historico">Seus assessments</h3>
              <ul className="lista">
                {linhas.map((l) => (
                  <li key={l.id}>
                    <span>
                      {l.empresa?.nome ? <strong>{l.empresa.nome}</strong> : "Empresa ainda não informada"} · Food service ·{" "}
                      {situacao(l)}
                    </span>
                    {l.status === "concluido" ? (
                      <Link href={`/assessment/${l.id}/resultado`}>Ver resultado</Link>
                    ) : (
                      <span className="acoes">
                        {temDireito && <Link href={`/assessment/${l.id}`}>Continuar</Link>}
                        <Descartar id={l.id} texto="Apagar as respostas deste rascunho (não dá para desfazer)" />
                      </span>
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
