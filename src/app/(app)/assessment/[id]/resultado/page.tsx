import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirContaAtiva } from "@/lib/auth/session";
import type { ResultadoSelf } from "@/lib/assessment/tipos";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "Resultado do Self assessment" };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pp = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** Resultado (versão inicial). A 7a.4 acrescenta oportunidades, mapa de dados e impressão. */
export default async function ResultadoPage({ params }: PageProps<"/assessment/[id]/resultado">) {
  await exigirContaAtiva();
  const { id } = await params;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  // RLS: dono, quem tem assessment.ver na empresa ou super-admin.
  const { data: linha } = await supabase.from("assessments").select("id, status").eq("id", id).maybeSingle();
  if (!linha) notFound();
  if (linha.status !== "concluido") redirect(`/assessment/${id}`);
  const { data: res } = await supabase
    .from("assessment_resultados")
    .select("resultado, criado_em")
    .eq("assessment_id", id)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ resultado: ResultadoSelf; criado_em: string }>();
  if (!res) notFound();
  const r = res.resultado;
  const cons = r.retorno.conservador;

  return (
    <main>
      <p className="eyebrow">
        <Link href="/assessment">Self assessment</Link> / resultado
      </p>
      <h1 className="title">Resultado</h1>

      <div className="resultado-numeros">
        <div>
          <p className="field-hint">Score de sucesso na implantação</p>
          <p className="resultado-numero">{pct.format(r.score.valor * 100)}%</p>
          <p>Nível {r.score.nivel}</p>
        </div>
        <div>
          <p className="field-hint">Retorno anual conservador</p>
          <p className="resultado-numero">{brl.format(cons.P)}</p>
          <p>{cons.delta_margem_pp === null ? "Margem: informe o faturamento para calcular" : `${pp.format(cons.delta_margem_pp)} p.p. de margem`}</p>
        </div>
      </div>

      <p className="notice" role="note">
        {r.score.ressalva} O retorno é uma estimativa conservadora a partir das suas respostas; o Deep dive mede com os
        dados reais da empresa.
      </p>
      {r.precisao_receita !== "informada" && (
        <p className="field-hint">O faturamento foi informado por faixa; o cálculo usa o limite inferior.</p>
      )}
      <p className="field-hint">
        Motor {r.versoes.motor} · modelo {r.versoes.modelo} · pacote {r.versoes.pacote} · código {r.hash_respostas}
      </p>
    </main>
  );
}
