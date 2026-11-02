import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirContaAtiva } from "@/lib/auth/session";
import { ROTULO_DIMENSAO, nomeOrigem } from "@/lib/assessment/self";
import type { ResultadoSelf } from "@/lib/assessment/tipos";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";
import { BotaoImprimir } from "./imprimir";

export const metadata: Metadata = { title: "Resultado do Self assessment" };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pp = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const nota = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });

const SITUACAO: Record<string, string> = { tem: "Registra", parcial: "Parcial", "não tem": "Não registra", "não sei": "A verificar" };

/**
 * Resultado do Self assessment. Os números vêm prontos do motor (gravados por
 * concluir_self); esta tela só formata. Mostra o cenário conservador em
 * destaque; o base aparece só como referência, e o otimista nunca.
 */
export default async function ResultadoPage({ params }: PageProps<"/assessment/[id]/resultado">) {
  await exigirContaAtiva();
  const { id } = await params;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  // RLS: dono, quem tem assessment.ver na empresa ou super-admin com MFA.
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
  const base = r.retorno.base;
  const destrava = r.o_que_destrava[0];
  const lacunas = r.mapa_de_dados.filter((m) => m.situacao !== "tem");

  return (
    <main className="resultado">
      <p className="eyebrow">
        <Link href="/assessment">Self assessment</Link> / resultado
      </p>
      <h1 className="title">Resultado</h1>
      <p className="field-hint">Food service · calculado em {dataHora.format(new Date(res.criado_em))}</p>

      <div className="resultado-numeros">
        <div>
          <p className="field-hint">Score de sucesso na implantação</p>
          <p className="resultado-numero">{pct.format(r.score.valor * 100)}%</p>
          <p>
            Nível {r.score.nivel} · prontidão {nota.format(r.score.nota_prontidao)} de 5
          </p>
        </div>
        <div>
          <p className="field-hint">Retorno anual conservador</p>
          <p className="resultado-numero">{brl.format(cons.P)}</p>
          <p>
            {cons.delta_margem_pp === null
              ? "Informe o faturamento em número para ver o efeito na margem."
              : `${pp.format(cons.delta_margem_pp)} p.p. de margem`}
          </p>
        </div>
      </div>

      <p className="notice" role="note">
        {r.score.ressalva} O retorno é uma estimativa conservadora a partir das suas respostas, acompanhada depois no
        DRE. O Deep dive mede com os dados reais da empresa.
      </p>
      {r.precisao_receita !== "informada" && (
        <p className="field-hint">O faturamento veio por faixa; o cálculo usa o limite inferior da faixa.</p>
      )}
      {r.avisos.length > 0 && (
        <p className="notice" role="note">
          A receita por pessoa ficou fora do padrão do setor. Vale conferir o faturamento e o número de pessoas informados.
        </p>
      )}
      <p className="field-hint">
        Referência: com prontidão maior, o mesmo potencial chega a {brl.format(base.P)} por ano (cenário base).
      </p>

      <section className="secao" aria-labelledby="sec-top3">
        <h2 id="sec-top3">Onde está o maior potencial</h2>
        <ol className="lista-resultado">
          {r.top3.map((t) => (
            <li key={t.origem}>
              <strong>{nomeOrigem(t.origem)}</strong>
              <span>{brl.format(t.valor_conservador)} por ano (conservador)</span>
              {t.exemplo && <span className="field-hint">Exemplo: {t.exemplo}</span>}
            </li>
          ))}
        </ol>
      </section>

      {destrava && (
        <section className="secao" aria-labelledby="sec-destrava">
          <h2 id="sec-destrava">O que destrava mais valor</h2>
          <p>
            Subir um nível em <strong>{ROTULO_DIMENSAO[destrava.dimensao] ?? destrava.dimensao}</strong> leva o score para{" "}
            {pct.format(destrava.score_novo * 100)}% (+{pp.format(destrava.ganho_score_pp)} p.p.) e acrescenta{" "}
            {brl.format(destrava.ganho_retorno)} por ano ao retorno conservador.
          </p>
        </section>
      )}

      <section className="secao" aria-labelledby="sec-dimensoes">
        <h2 id="sec-dimensoes">Prontidão por dimensão</h2>
        <p className="field-hint">Nota de 1 a 5. No Self assessment a nota máxima é 4; o 5 exige evidência no Deep dive.</p>
        <ul className="barras">
          {Object.entries(r.score.dimensoes).map(([d, n]) => (
            <li key={d}>
              <span>{ROTULO_DIMENSAO[d] ?? d}</span>
              <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <rect className="barra-fundo" x="0" y="0" width="100" height="6" />
                <rect className="barra-valor" x="0" y="0" width={Math.max(0, Math.min(100, (n / 5) * 100))} height="6" />
              </svg>
              <span>{nota.format(n)}</span>
            </li>
          ))}
        </ul>
        {r.score.teto_aplicado !== null && (
          <p className="field-hint">
            Estratégia ou Dados baixos limitam o score a {pct.format(r.score.teto_aplicado * 100)}%: sem patrocínio e sem dado,
            projetos de IA costumam parar no piloto.
          </p>
        )}
      </section>

      <section className="secao" aria-labelledby="sec-dados">
        <h2 id="sec-dados">Mapa de dados</h2>
        <p className="field-hint">
          {r.mapa_de_dados.length - lacunas.length} de {r.mapa_de_dados.length} informações registradas de forma regular.
        </p>
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Informação</th>
                <th scope="col">Situação</th>
                <th scope="col">Como resolver</th>
              </tr>
            </thead>
            <tbody>
              {r.mapa_de_dados.map((m) => (
                <tr key={m.fonte}>
                  <td>{m.nome}</td>
                  <td>{SITUACAO[m.situacao] ?? m.situacao}</td>
                  <td>
                    {m.como_criar ?? (m.situacao === "não sei" ? "Verificar no Deep dive" : "—")}
                    {m.criar_fonte_com_ia && <span className="selo selo-ia">IA pode criar</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="secao nao-imprimir" aria-labelledby="sec-proximo">
        <h2 id="sec-proximo">Próximo passo</h2>
        <p>Converse com a equipe IRON AI para levar este resultado à Sessão executiva e planejar o Deep dive.</p>
        <BotaoImprimir />
      </section>

      <p className="field-hint">
        Motor {r.versoes.motor} · modelo {r.versoes.modelo} · pacote {r.versoes.pacote} · código {r.hash_respostas}
      </p>
    </main>
  );
}
