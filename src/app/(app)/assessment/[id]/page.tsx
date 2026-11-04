import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirContaAtiva } from "@/lib/auth/session";
import { paraEscolhaMultipla, paraUnidades, type EmpresaSelf, type RespostasGravadas } from "@/lib/assessment/questionario";
import { montarQuestionario } from "@/lib/assessment/self";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";
import { MAX_TEXTO_CLIENTE } from "@/lib/assessment/agente/conversa";
import { agenteConfigurado } from "@/lib/env";
import { ConversaSelf } from "./conversa-self";
import { QuestionarioSelf } from "./questionario-self";

export const metadata: Metadata = { title: "Self assessment" };

export default async function ResponderPage({ params, searchParams }: PageProps<"/assessment/[id]">) {
  const perfil = await exigirContaAtiva();
  const { id } = await params;
  const { modo } = await searchParams;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  const { data: linha } = await supabase
    .from("assessments")
    .select("id, user_id, org_id, status, respostas, empresa, atualizado_em")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      user_id: string;
      org_id: string | null;
      status: string;
      respostas: RespostasGravadas | null;
      empresa: EmpresaSelf;
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
    return (
      <main>
        <p className="eyebrow">
          <Link href="/assessment">Self assessment</Link> / Food service
        </p>
        <h1 className="title">Em preenchimento</h1>
        <p className="notice" role="note">
          O Self assessment da empresa está sendo respondido. Seu acesso é de leitura: o resultado aparece aqui quando
          ele for concluído.
        </p>
      </main>
    );
  }

  // Cadastro vazio: sugere quem está respondendo como contato principal.
  let empresa: EmpresaSelf = linha.empresa ?? {};
  if (Object.keys(empresa).length === 0) {
    const { data: auth } = await supabase.auth.getUser();
    empresa = { contato_nome: perfil.nome, contato_email: auth.user?.email ?? undefined };
  }

  const inicial = paraUnidades(paraEscolhaMultipla(linha.respostas ?? {}));
  const questionario = montarQuestionario();
  // Conversa é o padrão (03/11/2026); o formulário fica como alternativa e
  // como reserva se a chave da API não estiver configurada.
  const conversa = modo !== "formulario" && agenteConfigurado();

  return (
    <main>
      <p className="eyebrow">
        <Link href="/assessment">Self assessment</Link> / Food service
      </p>
      <h1 className="title">{conversa ? "Self Assessment" : "Responder"}</h1>
      {conversa ? (
        <ConversaSelf
          assessmentId={id}
          questionario={questionario}
          inicial={inicial}
          inicialEmpresa={empresa}
          versaoInicial={linha.atualizado_em}
          maxTexto={MAX_TEXTO_CLIENTE}
        />
      ) : (
        <>
          <p className="field-hint">As respostas são salvas automaticamente. Você pode sair e voltar depois.</p>
          {agenteConfigurado() && (
            <p className="modo-troca">
              <Link href={`/assessment/${id}`}>Voltar para a conversa com o assistente</Link>
            </p>
          )}
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
