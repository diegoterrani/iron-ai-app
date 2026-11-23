import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { exigirContaAtiva } from "@/lib/auth/session";
import { paraEscolhaMultipla, paraUnidades, type EmpresaSelf, type RespostasGravadas } from "@/lib/assessment/questionario";
import { montarQuestionario } from "@/lib/assessment/self";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";
import { MAX_TEXTO_CLIENTE } from "@/lib/assessment/agente/conversa";
import { agenteConfigurado } from "@/lib/env";
import { DURACAO_SELF } from "@/lib/ui/textos";
import { aprofundamentoParaProgresso, eFormato06, montarQuestionario06 } from "@/lib/assessment/v06/self";
import { progresso06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import { CabecalhoSelf } from "./cabecalho-self";
import { ConversaSelf } from "./conversa-self";
import { EscolhaEmpresa } from "./escolha-empresa";
import { Formulario06 } from "./formulario-06";
import { IndicadorProgresso06 } from "./progresso-06";
import { QuestionarioSelf } from "./questionario-self";

export const metadata: Metadata = { title: "Self assessment" };

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function ResponderPage({ params, searchParams }: PageProps<"/assessment/[id]">) {
  const perfil = await exigirContaAtiva();
  const { id } = await params;
  const { modo } = await searchParams;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  const { data: linha } = await supabase
    .from("assessments")
    .select("id, user_id, org_id, status, respostas, empresa, empresa_id, atualizado_em")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      user_id: string;
      org_id: string | null;
      status: string;
      respostas: RespostasGravadas | null;
      empresa: EmpresaSelf;
      empresa_id: string | null;
      atualizado_em: string;
    }>();
  // RLS: lê o dono do pessoal ou quem tem assessment.ver na empresa.
  if (!linha) notFound();
  if (linha.status !== "rascunho") redirect(`/assessment/${id}/resultado`);

  // Editar: pessoal só o dono; da empresa quem tem assessment.editar (ADM e
  // RW-Cliente). O banco decide (RLS no update); aqui só escolhe a tela.
  const podeEditar =
    linha.org_id === null
      ? linha.user_id === perfil.id
      : (await supabase.rpc("tem_permissao", { p_permissao: "assessment.editar", p_org: linha.org_id })).data === true;
  if (!podeEditar) {
    if (linha.org_id === null) notFound();
    // Leitura (RO-Cliente): quanto falta e quando mudou, sem mostrar as respostas.
    const progresso = eFormato06(linha.respostas)
      ? progresso06(
          montarQuestionario06(),
          (linha.respostas ?? {}) as Rascunho06,
          linha.empresa ?? {},
          aprofundamentoParaProgresso((linha.respostas ?? {}) as Rascunho06),
        )
      : null;
    return (
      <main className="as-trabalho">
        <CabecalhoSelf assessmentId={id} titulo={linha.empresa?.nome ?? "Self assessment"} detalhe="Food service · em preenchimento" modo={null} />
        <p className="notice" role="note">
          O Self assessment da empresa está sendo respondido. Seu acesso é de leitura: o resultado aparece aqui quando
          ele for concluído.
        </p>
        {progresso && <IndicadorProgresso06 p={progresso} />}
        <p className="field-hint">Última alteração em {dataHora.format(new Date(linha.atualizado_em))}.</p>
      </main>
    );
  }

  // Cadastro vazio: sugere quem está respondendo como contato principal.
  let empresa: EmpresaSelf = linha.empresa ?? {};
  if (Object.keys(empresa).length === 0) {
    const { data: auth } = await supabase.auth.getUser();
    empresa = { contato_nome: perfil.nome, contato_email: auth.user?.email ?? undefined };
  }

  // Conversa é o padrão (03/11/2026); o formulário fica como alternativa e
  // como reserva se a chave da API não estiver configurada.
  const conversa = modo !== "formulario" && agenteConfigurado();

  // 0.6 (20/11/2026): rascunho novo segue o roteiro curto da skill do Self.
  if (eFormato06(linha.respostas)) {
    const q06 = montarQuestionario06();
    const inicial06 = (linha.respostas ?? {}) as Rascunho06;
    const aprofundamento06 = aprofundamentoParaProgresso(inicial06);
    // Assessment pessoal: escolher empresa do cadastro ou cadastrar nova (a
    // conversa e o formulário aparecem depois da escolha). O da organização
    // usa os dados dela. A chave remonta tudo quando a empresa muda.
    const pessoal = linha.org_id === null;
    const dadosEmpresa = linha.empresa ?? {};
    const local = [dadosEmpresa.cidade, dadosEmpresa.uf].filter(Boolean).join("/") || null;
    const chave = `${linha.empresa_id ?? "sem-empresa"}-${linha.atualizado_em}`;
    const miolo = (
      <>
        {conversa ? (
          <ConversaSelf
            key={chave}
            formato="0.6"
            assessmentId={id}
            questionario={q06}
            inicial={inicial06}
            aprofundamentoInicial={aprofundamento06}
            inicialEmpresa={empresa}
            versaoInicial={linha.atualizado_em}
            maxTexto={MAX_TEXTO_CLIENTE}
          />
        ) : (
          <>
            <Formulario06
              key={chave}
              assessmentId={id}
              questionario={q06}
              inicial={inicial06}
              inicialEmpresa={empresa}
              versaoInicial={linha.atualizado_em}
              aprofundamentoInicial={aprofundamento06}
            />
          </>
        )}
      </>
    );
    return (
      <main className="as-trabalho">
        <CabecalhoSelf
          assessmentId={id}
          titulo={dadosEmpresa.nome ?? "Self assessment"}
          detalhe={`Food service · ${DURACAO_SELF} · salvo automaticamente`}
          modo={agenteConfigurado() ? (conversa ? "conversa" : "formulario") : null}
        />
        {pessoal ? (
          <EscolhaEmpresa
            key={chave}
            assessmentId={id}
            vinculada={linha.empresa_id && dadosEmpresa.nome ? { nome: dadosEmpresa.nome, local } : null}
            abrir={!linha.empresa_id && !dadosEmpresa.nome}
          >
            {miolo}
          </EscolhaEmpresa>
        ) : (
          miolo
        )}
      </main>
    );
  }

  const inicial = paraUnidades(paraEscolhaMultipla(linha.respostas ?? {}));
  const questionario = montarQuestionario();

  return (
    <main className="as-trabalho">
      <CabecalhoSelf
        assessmentId={id}
        titulo={linha.empresa?.nome ?? "Self assessment"}
        detalhe="Food service · salvo automaticamente"
        modo={agenteConfigurado() ? (conversa ? "conversa" : "formulario") : null}
      />
      {conversa ? (
        <ConversaSelf
          formato="0.5"
          assessmentId={id}
          questionario={questionario}
          inicial={inicial}
          inicialEmpresa={empresa}
          versaoInicial={linha.atualizado_em}
          maxTexto={MAX_TEXTO_CLIENTE}
        />
      ) : (
        <>
          <QuestionarioSelf
            assessmentId={id}
            questionario={questionario}
            inicial={inicial}
            inicialEmpresa={empresa}
            versaoInicial={linha.atualizado_em}
          />
        </>
      )}
    </main>
  );
}
