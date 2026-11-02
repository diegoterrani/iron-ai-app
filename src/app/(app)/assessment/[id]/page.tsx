import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirContaAtiva } from "@/lib/auth/session";
import type { RespostasSelf } from "@/lib/assessment/questionario";
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
    .select("id, user_id, status, respostas")
    .eq("id", id)
    .maybeSingle<{ id: string; user_id: string; status: string; respostas: RespostasSelf }>();
  // Só o dono responde (empresa e admin podem ler, não editar).
  if (!linha || linha.user_id !== perfil.id) notFound();
  if (linha.status !== "rascunho") redirect(`/assessment/${id}/resultado`);

  return (
    <main>
      <p className="eyebrow">
        <Link href="/assessment">Self assessment</Link> / Food service
      </p>
      <h1 className="title">Responder</h1>
      <p className="field-hint">As respostas são salvas automaticamente. Você pode sair e voltar depois.</p>
      <QuestionarioSelf assessmentId={id} questionario={montarQuestionario()} inicial={linha.respostas ?? {}} />
    </main>
  );
}
