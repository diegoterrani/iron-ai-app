import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcaoForm } from "@/components/acao-form";
import { AREAS, roteiroDeep, type RespostaVigente } from "@/lib/assessment/deep/roteiro";
import { ROTULO_AREA, formatarValor, progressoDoDeep } from "@/lib/assessment/deep/tela";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";
import { abrirReuniao, fecharPendencia } from "../actions";

export const metadata: Metadata = { title: "Painel do Deep" };

interface Deep {
  id: string;
  org_id: string;
  status: "em_andamento" | "concluido" | "cancelado";
  pacote_versao: string;
  turnos: number;
  criado_em: string;
}

interface Sessao {
  id: string;
  numero: number;
  area: string;
  titulo: string;
  status: "aberta" | "encerrada";
  participantes: { nome: string; cargo?: string }[];
  iniciada_em: string;
  encerrada_em: string | null;
}

interface Resposta {
  pergunta_id: string;
  area: string;
  valor: unknown;
  nao_se_aplica: boolean;
  confianca: string;
  sessao_id: string;
}

interface Pendencia {
  id: string;
  fonte: string | null;
  descricao: string;
  responsavel: string | null;
  prazo: string | null;
}

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" });

/** Painel do Deep: progresso por área, reuniões, pendências e respostas vigentes. */
export default async function PainelDeepPage({ params }: PageProps<"/deep/[id]">) {
  const { id } = await params;
  if (!idValido(id)) notFound();

  const supabase = await createClient();
  const { data: deep } = await supabase
    .from("deep_assessments")
    .select("id, org_id, status, pacote_versao, turnos, criado_em")
    .eq("id", id)
    .maybeSingle<Deep>();
  // RLS: só quem tem deep.conduzir na empresa enxerga o Deep.
  if (!deep) notFound();

  const [orgRes, sessoesRes, respostasRes, pendenciasRes] = await Promise.all([
    supabase.from("organizations").select("nome").eq("id", deep.org_id).maybeSingle<{ nome: string }>(),
    supabase
      .from("deep_sessoes")
      .select("id, numero, area, titulo, status, participantes, iniciada_em, encerrada_em")
      .eq("deep_id", id)
      .order("numero", { ascending: false }),
    supabase
      .from("deep_respostas")
      .select("pergunta_id, area, valor, nao_se_aplica, confianca, sessao_id")
      .eq("deep_id", id)
      .eq("status", "vigente"),
    supabase
      .from("deep_pendencias")
      .select("id, fonte, descricao, responsavel, prazo")
      .eq("deep_id", id)
      .eq("status", "aberta")
      .order("criado_em"),
  ]);
  const sessoes = (sessoesRes.data ?? []) as Sessao[];
  const respostas = (respostasRes.data ?? []) as Resposta[];
  const pendencias = (pendenciasRes.data ?? []) as Pendencia[];
  const numeroSessao = new Map(sessoes.map((s) => [s.id, s.numero]));
  const vigentes: Record<string, RespostaVigente> = Object.fromEntries(
    respostas.map((r) => [r.pergunta_id, { valor: r.valor, nao_se_aplica: r.nao_se_aplica }]),
  );
  const porPergunta = new Map(respostas.map((r) => [r.pergunta_id, r]));
  const progresso = progressoDoDeep(roteiroDeep, vigentes);
  const emAndamento = deep.status === "em_andamento";
  const abertas = new Set(sessoes.filter((s) => s.status === "aberta").map((s) => s.area));

  return (
    <main>
      <p className="eyebrow">
        <Link href="/deep">Deep assessment</Link> / {orgRes.data?.nome ?? "Empresa"}
      </p>
      <h1 className="title">{orgRes.data?.nome ?? "Deep assessment"}</h1>
      <p className="field-hint">
        Aberto em {dataHora.format(new Date(deep.criado_em))} · roteiro {deep.pacote_versao} · {deep.turnos} turnos ·{" "}
        {emAndamento ? "em andamento" : deep.status === "concluido" ? "concluído" : "cancelado"}
      </p>
      {deep.pacote_versao !== roteiroDeep.pacoteVersao && (
        <p className="notice notice-error" role="alert">
          Este Deep usa o roteiro {deep.pacote_versao} e o app está no {roteiroDeep.pacoteVersao}. O agente não conduz reuniões
          dele até a migração do roteiro.
        </p>
      )}

      <section className="secao" aria-labelledby="sec-progresso">
        <h2 id="sec-progresso">Progresso por área</h2>
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Área</th>
                <th scope="col">Núcleo respondido</th>
                <th scope="col">Perguntas abertas</th>
                <th scope="col">Esperando outra resposta</th>
              </tr>
            </thead>
            <tbody>
              {progresso.map((p) => (
                <tr key={p.area}>
                  <th scope="row">
                    {ROTULO_AREA[p.area]}: {p.nome}
                  </th>
                  <td>
                    {p.nucleoRespondidas} de {p.nucleoTotal}
                  </td>
                  <td>{p.abertas}</td>
                  <td>{p.aguardandoGatilho}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="secao" aria-labelledby="sec-reunioes">
        <h2 id="sec-reunioes">Reuniões</h2>
        {sessoes.length === 0 ? (
          <p className="field-hint">Nenhuma reunião ainda.</p>
        ) : (
          <ul className="lista">
            {sessoes.map((s) => (
              <li key={s.id}>
                <span>
                  <Link href={`/deep/${id}/reuniao/${s.id}`}>
                    {s.numero}. {s.titulo}
                  </Link>{" "}
                  <span className={s.status === "aberta" ? "selo selo-pendente" : "selo"}>{s.status === "aberta" ? "aberta" : "encerrada"}</span>
                </span>
                <span className="field-hint">
                  {ROTULO_AREA[s.area as keyof typeof ROTULO_AREA] ?? s.area} · {dataHora.format(new Date(s.iniciada_em))} ·{" "}
                  {s.participantes.length} participantes
                </span>
              </li>
            ))}
          </ul>
        )}

        {emAndamento && (
          <>
            <h3>Nova reunião</h3>
            <AcaoForm action={abrirReuniao} campos={{ deepId: id }} rotulo="Começar reunião" rotuloEnviando="Abrindo…" className="acao-form acao-form-coluna">
              <div className="field">
                <label htmlFor="area">Área</label>
                <select id="area" name="area" required defaultValue="">
                  <option value="" disabled>
                    Escolha
                  </option>
                  {AREAS.map((a) => (
                    <option key={a} value={a}>
                      {ROTULO_AREA[a]}: {roteiroDeep.areas[a].nome}
                      {abertas.has(a) ? " (retomar a reunião aberta)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="titulo">Título</label>
                <input id="titulo" name="titulo" required minLength={2} maxLength={200} placeholder="Ex.: Cozinha central com o chef" />
              </div>
              <div className="field">
                <label htmlFor="participantes">Participantes</label>
                <textarea id="participantes" name="participantes" rows={4} maxLength={5000} placeholder={"Uma pessoa por linha: Nome - Cargo"} />
                <p className="field-hint">Só nome e cargo. Nada de e-mail, telefone ou documento.</p>
              </div>
            </AcaoForm>
          </>
        )}
      </section>

      <section className="secao" aria-labelledby="sec-pendencias">
        <h2 id="sec-pendencias">Pendências abertas</h2>
        {pendencias.length === 0 ? (
          <p className="field-hint">Nenhuma pendência aberta.</p>
        ) : (
          <ul className="lista">
            {pendencias.map((p) => (
              <li key={p.id}>
                <span>
                  {p.fonte && <span className="selo">{p.fonte}</span>} {p.descricao}
                  <span className="field-hint deep-detalhe">
                    {p.responsavel ? `Responsável: ${p.responsavel}` : "Sem responsável"}
                    {p.prazo ? ` · prazo ${dataCurta.format(new Date(p.prazo))}` : ""}
                  </span>
                </span>
                {emAndamento && (
                  <AcaoForm action={fecharPendencia} campos={{ deepId: id, pendenciaId: p.id }} rotulo="Fechar" variante="secundario">
                    <div className="field">
                      <label htmlFor={`status-${p.id}`}>Situação</label>
                      <select id={`status-${p.id}`} name="status" defaultValue="recebida">
                        <option value="recebida">Recebida</option>
                        <option value="cancelada">Cancelada</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`nota-${p.id}`}>Nota (opcional)</label>
                      <input id={`nota-${p.id}`} name="nota" maxLength={1000} />
                    </div>
                  </AcaoForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="secao" aria-labelledby="sec-respostas">
        <h2 id="sec-respostas">Respostas registradas</h2>
        {AREAS.map((a) => {
          const perguntas = roteiroDeep.perguntas.filter((p) => p.area === a && porPergunta.has(p.id));
          return (
            <details key={a} className="deep-area">
              <summary>
                {ROTULO_AREA[a]}: {roteiroDeep.areas[a].nome} ({perguntas.length})
              </summary>
              {perguntas.length === 0 ? (
                <p className="field-hint">Nada registrado ainda.</p>
              ) : (
                <div className="tabela-rolagem">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th scope="col">Pergunta</th>
                        <th scope="col">Resposta</th>
                        <th scope="col">Confiança</th>
                        <th scope="col">Reunião</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perguntas.map((p) => {
                        const r = porPergunta.get(p.id)!;
                        return (
                          <tr key={p.id}>
                            <td>
                              <span className="deep-id">{p.id}</span> {p.texto}
                            </td>
                            <td>{formatarValor(p, r.valor, r.nao_se_aplica)}</td>
                            <td>{r.confianca === "media" ? "média" : r.confianca}</td>
                            <td>{numeroSessao.get(r.sessao_id) ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          );
        })}
      </section>
    </main>
  );
}
