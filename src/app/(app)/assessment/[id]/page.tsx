import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirContaAtiva } from "@/lib/auth/session";
import { paraEscolhaMultipla, type EmpresaSelf, type RespostasGravadas } from "@/lib/assessment/questionario";
import { montarQuestionario } from "@/lib/assessment/self";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";
import { QuestionarioSelf } from "./questionario-self";

export const metadata: Metadata = { title: "Self assessment" };

export default async function ResponderPage({ params }: PageProps<"/assessment/[id]">) {
  const perfil = await exigirContaAtiva();
  const { id } = await params;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  const { data: linha } = await supabase
    .from("assessments")
    .select("id, user_id, status, respostas, empresa")
    .eq("id", id)
    .maybeSingle<{ id: string; user_id: string; status: string; respostas: RespostasGravadas | null; empresa: EmpresaSelf }>();
  // Só o dono responde (empresa e admin podem ler, não editar).
  if (!linha || linha.user_id !== perfil.id) notFound();
  if (linha.status !== "rascunho") redirect(`/assessment/${id}/resultado`);

  // Cadastro vazio: sugere quem está respondendo como contato principal.
  let empresa: EmpresaSelf = linha.empresa ?? {};
  if (Object.keys(empresa).length === 0) {
    const { data: auth } = await supabase.auth.getUser();
    empresa = { contato_nome: perfil.nome, contato_email: auth.user?.email ?? undefined };
  }

  return (
    <main>
      <p className="eyebrow">
        <Link href="/assessment">Self assessment</Link> / Food service
      </p>
      <h1 className="title">Responder</h1>
      <p className="field-hint">As respostas são salvas automaticamente. Você pode sair e voltar depois.</p>
      <QuestionarioSelf assessmentId={id} questionario={montarQuestionario()} inicial={paraEscolhaMultipla(linha.respostas ?? {})} inicialEmpresa={empresa} />
    </main>
  );
}
