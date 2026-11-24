import type { Metadata } from "next";
import Link from "next/link";
import { AcaoForm } from "@/components/acao-form";
import { exigirContaAtiva, getSessao } from "@/lib/auth/session";
import type { EmpresaSelf } from "@/lib/assessment/questionario";
import { ROTULO_PAPEL } from "@/lib/validation/admin";
import { createClient } from "@/lib/supabase/server";
import { CONTATO_URL, DURACAO_SELF } from "@/lib/ui/textos";
import { descartarRascunho, excluirAssessment, excluirCadastroEmpresa, iniciarSelf } from "./actions";
import { passosDoRascunho } from "./progresso";

export const metadata: Metadata = { title: "Self assessment" };

interface Linha {
  id: string;
  status: "rascunho" | "concluido";
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
  respostas: unknown;
  empresa: EmpresaSelf | null;
}

const CAMPOS = "id, status, criado_em, atualizado_em, concluido_em, respostas, empresa";
const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Papéis de cliente que respondem e editam o assessment da empresa (a tela só esconde; o banco decide). */
const EDITA = new Set(["adm_cliente", "rw_cliente"]);
/** Papéis globais da IRON que podem responder pela empresa que atendem (com MFA). */
const STAFF = new Set(["super_admin", "equipe_iron"]);

/**
 * Cancelar (descartar o rascunho) fica recolhido: não disputa atenção com
 * "Continuar" e pede confirmação. Quem decide se pode é o banco.
 */
function Cancelar({ id, texto }: { id: string; texto: string }) {
  return (
    <details className="mais-opcoes">
      <summary>Cancelar assessment</summary>
      <AcaoForm action={descartarRascunho} campos={{ assessmentId: id }} rotulo="Cancelar e apagar o rascunho" rotuloEnviando="Cancelando…" variante="perigo">
        <label className="check">
          <input type="checkbox" name="confirmar" required />
          <span>{texto}</span>
        </label>
      </AcaoForm>
    </details>
  );
}

/** Estado do rascunho: barra de progresso nativa (acessível e sem estilo inline). */
function EstadoRascunho({ l }: { l: Linha }) {
  const p = passosDoRascunho(l.respostas, l.empresa);
  return (
    <div className="as-estado">
      <div className="as-estado-topo">
        <span className="selo selo-pendente">Em andamento</span>
        <span className="as-meta">alterado em {dataHora.format(new Date(l.atualizado_em))}</span>
      </div>
      {p && (
        <>
          <progress className="as-barra" max={p.total} value={p.feitos} aria-label={`${p.feitos} de ${p.total} passos`} />
          <p className="as-meta">
            {p.feitos} de {p.total} passos
          </p>
        </>
      )}
    </div>
  );
}

/** Parar não é uma ação: tudo é salvo a cada resposta, basta sair e voltar. */
function DicaParar() {
  return <p className="as-dica">Para parar, é só sair: as respostas ficam salvas e você continua daqui quando quiser.</p>;
}

/** Excluir um resultado: recolhido, com confirmação; o banco decide e audita. */
function ExcluirResultado({ id }: { id: string }) {
  return (
    <details className="mais-opcoes as-excluir">
      <summary>Excluir</summary>
      <AcaoForm action={excluirAssessment} campos={{ assessmentId: id }} rotulo="Excluir este assessment" rotuloEnviando="Excluindo…" variante="perigo">
        <label className="check">
          <input type="checkbox" name="confirmar" required />
          <span>Apagar o resultado, o relatório e a conversa deste assessment (não dá para desfazer)</span>
        </label>
      </AcaoForm>
    </details>
  );
}

/** Concluídos: link para o resultado (do mais recente para o mais antigo) e, para quem pode, excluir. */
function Historico({ linhas, podeExcluir }: { linhas: Linha[]; podeExcluir: boolean }) {
  const concluidos = linhas.filter((l) => l.status === "concluido");
  if (concluidos.length === 0) return null;
  return (
    <div className="as-historico">
      <p className="as-historico-titulo">Resultados</p>
      <ul>
        {concluidos.map((l) => (
          <li key={l.id}>
            <Link href={`/assessment/${l.id}/resultado`}>
              <span>
                Food service · {data.format(new Date(l.concluido_em ?? l.criado_em))}
                {l.empresa?.nome ? ` · ${l.empresa.nome}` : ""}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
            {podeExcluir && <ExcluirResultado id={l.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Cartão do assessment da empresa: um rascunho só, que ADM e RW-Cliente editam e
 * RO-Cliente acompanha. A Equipe IRON atribuída à empresa também responde
 * (conduz o Self com o cliente); o banco confere a permissão e o MFA.
 */
async function CartaoEmpresa({ orgId, nome, papel, atende }: { orgId: string; nome: string; papel: string | null; atende: boolean }) {
  const supabase = await createClient();
  const [direitoRes, lista, editaRes] = await Promise.all([
    supabase.rpc("tem_direito", { p_produto: "self_assessment", p_org: orgId }),
    supabase.from("assessments").select(CAMPOS).eq("org_id", orgId).order("criado_em", { ascending: false }).limit(20),
    // Quem só atende a empresa (sem papel nela): o banco diz se pode editar.
    papel === null ? supabase.rpc("tem_permissao", { p_permissao: "assessment.editar", p_org: orgId }) : Promise.resolve({ data: null }),
  ]);
  const temDireito = direitoRes.data === true;
  const edita = papel !== null ? EDITA.has(papel) : editaRes.data === true;
  const adm = papel === "adm_cliente";
  const linhas = (lista.data ?? []) as Linha[];
  const rascunho = linhas.find((l) => l.status === "rascunho");

  const quem = papel !== null ? (ROTULO_PAPEL[papel] ?? papel) : atende ? "Você atende pela IRON AI" : null;
  const explicacao = edita
    ? papel === null
      ? "Você conduz o assessment com o cliente; ele vê o resultado na área da empresa."
      : "Você e os colegas com permissão de escrita preenchem o mesmo assessment."
    : "Você acompanha em modo leitura.";

  return (
    <article className="as-cartao" aria-labelledby={`as-empresa-${orgId}`}>
      <header className="as-cartao-topo">
        <p className="as-cartao-tipo">Assessment da empresa</p>
        <h2 id={`as-empresa-${orgId}`}>{nome}</h2>
        {quem && <span className="selo">{quem}</span>}
      </header>
      <p className="as-cartao-texto">{explicacao}</p>

      {rascunho ? <EstadoRascunho l={rascunho} /> : <p className="as-meta">Nenhum assessment em andamento.</p>}

      <div className="as-cartao-acoes">
        {edita ? (
          temDireito ? (
            <AcaoForm
              action={iniciarSelf}
              campos={{ orgId }}
              rotulo={rascunho ? "Continuar" : "Começar assessment"}
              rotuloEnviando="Abrindo…"
              className="acao-form"
            />
          ) : papel === null ? (
            <p className="notice" role="note">
              O Self assessment não está liberado para esta empresa. Libere em Backoffice, na ficha da empresa (Acessos da empresa).
            </p>
          ) : (
            <p className="notice" role="note">
              Ainda não liberado para esta empresa. <a href={CONTATO_URL}>Fale com a equipe IRON AI</a> para contratar.
            </p>
          )
        ) : (
          rascunho && (
            <Link className="btn btn-inline btn-secondary btn-link" href={`/assessment/${rascunho.id}`}>
              Acompanhar
            </Link>
          )
        )}
        {rascunho && adm && <Cancelar id={rascunho.id} texto="Apagar as respostas da empresa neste rascunho (não dá para desfazer)" />}
      </div>
      {rascunho && edita && <DicaParar />}

      <Historico linhas={linhas} podeExcluir={adm} />
    </article>
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
  const [direitoRes, lista, empresasRes, cadastrosRes] = await Promise.all([
    supabase.rpc("tem_direito", { p_produto: "self_assessment" }),
    supabase.from("assessments").select(CAMPOS).eq("user_id", perfil.id).is("org_id", null).order("criado_em", { ascending: false }).limit(20),
    idsEmpresas.length > 0
      ? supabase.from("organizations").select("id, nome").in("id", idsEmpresas).order("nome")
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    // Empresas que a própria pessoa cadastrou no Self (a equipe IRON vê as de todos pela RLS; aqui só as suas).
    supabase.from("empresas_cadastro").select("id, nome").eq("criado_por", perfil.id).order("nome").limit(50),
  ]);
  const cadastros = (cadastrosRes.data ?? []) as { id: string; nome: string }[];
  const temDireito = direitoRes.data === true;
  const linhas = (lista.data ?? []) as Linha[];
  const rascunho = linhas.find((l) => l.status === "rascunho");
  const empresas = (empresasRes.data ?? []) as { id: string; nome: string }[];
  const atendidasSet = new Set(atendidas);
  const mostrarPessoal = temDireito || linhas.length > 0 || empresas.length === 0;

  return (
    <main className="as-hub">
      <header className="as-cabecalho">
        <div>
          <p className="eyebrow">Assessments</p>
          <h1 className="title">Self assessment</h1>
          <p className="lead">
            Quanto lucro a empresa deixa na mesa com processos que a IA ajuda, o que já está medido e um ganho rápido de 6 semanas.
          </p>
        </div>
        <ul className="as-fatos" aria-label="Como funciona">
          <li>
            <strong>{DURACAO_SELF.replace("cerca de ", "~")}</strong>
            <span>para responder</span>
          </li>
          <li>
            <strong>Conversa ou formulário</strong>
            <span>você escolhe</span>
          </li>
          <li>
            <strong>Salvo sozinho</strong>
            <span>pare e volte quando quiser</span>
          </li>
        </ul>
      </header>

      {eStaff && atendidas.length === 0 && (
        <p className="notice" role="note">
          Para conduzir o Self de um cliente no nome da empresa dele, atribua-se à empresa em Backoffice (ficha do usuário, &ldquo;Empresas que
          atende&rdquo;).
        </p>
      )}

      <div className="as-grade">
        {empresas.map((e) => (
          <CartaoEmpresa key={e.id} orgId={e.id} nome={e.nome} papel={papelEm.get(e.id) ?? null} atende={atendidasSet.has(e.id)} />
        ))}

        {mostrarPessoal && (
          <article className="as-cartao" aria-labelledby="as-pessoal">
            <header className="as-cartao-topo">
              <p className="as-cartao-tipo">Só você vê</p>
              <h2 id="as-pessoal">Assessment pessoal</h2>
            </header>
            <p className="as-cartao-texto">
              {rascunho?.empresa?.nome ? `Respondendo por ${rascunho.empresa.nome}.` : "Para conhecer o Self antes de levar à empresa."}
            </p>
            {rascunho ? <EstadoRascunho l={rascunho} /> : <p className="as-meta">Nenhum assessment em andamento.</p>}
            <div className="as-cartao-acoes">
              {temDireito ? (
                <AcaoForm action={iniciarSelf} rotulo={rascunho ? "Continuar" : "Começar assessment"} rotuloEnviando="Abrindo…" className="acao-form" />
              ) : (
                empresas.length === 0 && (
                  <p className="notice" role="note">
                    Seu acesso ainda não está liberado. <a href={CONTATO_URL}>Fale com a equipe IRON AI</a> para contratar.
                  </p>
                )
              )}
              {rascunho && <Cancelar id={rascunho.id} texto="Apagar as respostas deste rascunho (não dá para desfazer)" />}
            </div>
            {rascunho && temDireito && <DicaParar />}
            <Historico linhas={linhas} podeExcluir />
          </article>
        )}
      </div>

      {cadastros.length > 0 && (
        <section className="as-cadastros" aria-labelledby="as-cadastros">
          <h2 id="as-cadastros">Empresas que você cadastrou</h2>
          <p className="as-meta">Usadas para preencher o Self. Excluir o cadastro não apaga os resultados já feitos com ele; um rascunho que o usava pede a empresa de novo.</p>
          <ul>
            {cadastros.map((c) => (
              <li key={c.id}>
                <span>{c.nome}</span>
                <details className="mais-opcoes as-excluir">
                  <summary>Excluir</summary>
                  <AcaoForm
                    action={excluirCadastroEmpresa}
                    campos={{ empresaId: c.id }}
                    rotulo="Excluir este cadastro"
                    rotuloEnviando="Excluindo…"
                    variante="perigo"
                  >
                    <label className="check">
                      <input type="checkbox" name="confirmar" required />
                      <span>Apagar o cadastro de {c.nome} (não dá para desfazer)</span>
                    </label>
                  </AcaoForm>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="as-nota">
        Não informe dados pessoais de clientes ou funcionários. O assessment pessoal fica visível só para você; o da empresa, para as pessoas que
        ela autorizar.
      </p>
    </main>
  );
}
