import type { Metadata } from "next";
import Link from "next/link";
import { AcaoForm } from "@/components/acao-form";
import { exigirContaAtiva } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { iniciarSelf } from "./actions";

export const metadata: Metadata = { title: "Self assessment" };

interface Linha {
  id: string;
  status: "rascunho" | "concluido";
  criado_em: string;
  concluido_em: string | null;
}

const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function AssessmentPage() {
  const perfil = await exigirContaAtiva();
  const supabase = await createClient();
  const [direitoRes, lista] = await Promise.all([
    supabase.rpc("tem_direito", { p_produto: "self_assessment" }),
    supabase
      .from("assessments")
      .select("id, status, criado_em, concluido_em")
      .eq("user_id", perfil.id)
      .order("criado_em", { ascending: false })
      .limit(20),
  ]);
  const temDireito = direitoRes.data === true;
  const linhas = (lista.data ?? []) as Linha[];
  const rascunho = linhas.find((l) => l.status === "rascunho");

  return (
    <main>
      <p className="eyebrow">Assessments</p>
      <h1 className="title">Self assessment</h1>
      <p className="lead">
        Em cerca de 12 minutos, você responde 16 perguntas sobre a operação e recebe o score de sucesso na
        implantação de IA, o retorno anual conservador em R$ e o mapa de dados da empresa.
      </p>
      <p className="field-hint">
        Não peça nem informe dados pessoais de clientes ou funcionários. As respostas ficam visíveis só para você e,
        se responder por uma empresa, para quem ela autorizar.
      </p>

      {temDireito ? (
        <AcaoForm
          action={iniciarSelf}
          rotulo={rascunho ? "Continuar de onde parei" : "Começar"}
          rotuloEnviando="Abrindo…"
          className="acao-form secao-acao"
        />
      ) : (
        <p className="notice" role="note">
          Seu acesso ao Self assessment ainda não está liberado. Fale com a equipe IRON AI para contratar.
        </p>
      )}

      {linhas.length > 0 && (
        <section className="secao" aria-labelledby="sec-historico">
          <h2 id="sec-historico">Seus assessments</h2>
          <ul className="lista">
            {linhas.map((l) => (
              <li key={l.id}>
                <span>
                  Food service · {l.status === "concluido" ? `concluído em ${data.format(new Date(l.concluido_em ?? l.criado_em))}` : `rascunho iniciado em ${data.format(new Date(l.criado_em))}`}
                </span>
                {l.status === "concluido" ? (
                  <Link href={`/assessment/${l.id}/resultado`}>Ver resultado</Link>
                ) : (
                  temDireito && <Link href={`/assessment/${l.id}`}>Continuar</Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
