import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcaoForm } from "@/components/acao-form";
import { MAX_TEXTO_ANALISTA } from "@/lib/assessment/deep/agente/turno";
import { estadoGatilho, roteiroDeep, type PerguntaDeep, type RespostaVigente } from "@/lib/assessment/deep/roteiro";
import { ROTULO_AREA, areaValida, falasDaReuniao, formatarValor, rotuloOpcao, valorParaCampo } from "@/lib/assessment/deep/tela";
import { agenteConfigurado } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";
import { corrigirResposta } from "../../../actions";
import { ReuniaoDeep } from "./reuniao-deep";

export const metadata: Metadata = { title: "Reunião" };

interface Sessao {
  id: string;
  deep_id: string;
  numero: number;
  area: string;
  titulo: string;
  status: "aberta" | "encerrada";
  participantes: { nome: string; cargo?: string }[];
  resumo: string | null;
}

interface Resposta {
  pergunta_id: string;
  valor: unknown;
  nao_se_aplica: boolean;
  confianca: string;
  participante: string | null;
  trecho: string | null;
}

const ROTULO_CONFIANCA: Record<string, string> = { alta: "alta", media: "média", baixa: "baixa" };

/**
 * Tela da reunião: à esquerda a conversa com o agente, à direita as
 * perguntas da área com o que já foi registrado e a correção manual.
 * Reunião encerrada abre só para leitura, com o resumo.
 */
export default async function ReuniaoPage({ params }: PageProps<"/deep/[id]/reuniao/[sessao]">) {
  const { id, sessao: sessaoId } = await params;
  if (!idValido(id) || !idValido(sessaoId)) notFound();

  const supabase = await createClient();
  const { data: sessao } = await supabase
    .from("deep_sessoes")
    .select("id, deep_id, numero, area, titulo, status, participantes, resumo")
    .eq("id", sessaoId)
    .eq("deep_id", id)
    .maybeSingle<Sessao>();
  // RLS: só o analista com deep.conduzir na empresa enxerga a reunião.
  if (!sessao || !areaValida(sessao.area)) notFound();

  const [deepRes, mensagensRes, respostasRes] = await Promise.all([
    supabase.from("deep_assessments").select("status, pacote_versao").eq("id", id).maybeSingle<{ status: string; pacote_versao: string }>(),
    supabase.from("deep_mensagens").select("papel, conteudo").eq("sessao_id", sessaoId).order("ordem").limit(2000),
    supabase
      .from("deep_respostas")
      .select("pergunta_id, valor, nao_se_aplica, confianca, participante, trecho")
      .eq("deep_id", id)
      .eq("status", "vigente"),
  ]);
  const respostas = (respostasRes.data ?? []) as Resposta[];
  const porPergunta = new Map(respostas.map((r) => [r.pergunta_id, r]));
  const vigentes: Record<string, RespostaVigente> = Object.fromEntries(
    respostas.map((r) => [r.pergunta_id, { valor: r.valor, nao_se_aplica: r.nao_se_aplica }]),
  );
  const falas = falasDaReuniao((mensagensRes.data ?? []) as { papel: unknown; conteudo: unknown }[]);
  const area = sessao.area;
  const aberta = sessao.status === "aberta" && deepRes.data?.status === "em_andamento";
  const roteiroCerto = deepRes.data?.pacote_versao === roteiroDeep.pacoteVersao;
  const perguntas = roteiroDeep.perguntas.filter((p) => p.area === area);
  const respondidas = perguntas.filter((p) => porPergunta.has(p.id)).length;

  return (
    <main className="reuniao">
      <p className="eyebrow">
        <Link href="/deep">Deep assessment</Link> / <Link href={`/deep/${id}`}>Painel</Link> / Reunião {sessao.numero}
      </p>
      <h1 className="title">{sessao.titulo}</h1>
      <p className="field-hint">
        {ROTULO_AREA[area]}: {roteiroDeep.areas[area].nome}
        {sessao.participantes.length > 0 &&
          ` · ${sessao.participantes.map((p) => (p.cargo ? `${p.nome} (${p.cargo})` : p.nome)).join(", ")}`}
      </p>

      <div className="reuniao-grade">
        <div className="reuniao-conversa">
          {!aberta && (
            <div className="resumo-conversa">
              <h2 className="pergunta-titulo">Reunião encerrada</h2>
              <p className="deep-resumo">{sessao.resumo ?? "Sem resumo."}</p>
            </div>
          )}
          {aberta && !roteiroCerto && (
            <p className="notice notice-error" role="alert">
              Este Deep usa outra versão do roteiro. O agente não conduz esta reunião.
            </p>
          )}
          {aberta && roteiroCerto && !agenteConfigurado() && (
            <p className="notice notice-error" role="alert">
              O agente está indisponível (chave da API não configurada). Registre as respostas pelo painel ao lado.
            </p>
          )}
          <ReuniaoDeep
            deepId={id}
            sessaoId={sessaoId}
            falasIniciais={falas}
            aberta={aberta && roteiroCerto && agenteConfigurado()}
            podeEncerrar={aberta}
            maxTexto={MAX_TEXTO_ANALISTA}
          />
        </div>

        <aside className="reuniao-painel" aria-labelledby="sec-painel">
          <h2 id="sec-painel">
            Perguntas da área ({respondidas} de {perguntas.length})
          </h2>
          <ol className="deep-perguntas">
            {perguntas.map((p) => {
              const r = porPergunta.get(p.id);
              const gatilho = estadoGatilho(roteiroDeep, p, vigentes);
              return (
                <li key={p.id} className={r ? "deep-pergunta deep-pergunta-respondida" : "deep-pergunta"}>
                  <p className="deep-pergunta-texto">
                    <span className="deep-id">{p.id}</span>
                    {p.nucleo && <span className="selo">núcleo</span>} {p.texto}
                  </p>
                  {r ? (
                    <p className="deep-valor">
                      <strong>{formatarValor(p, r.valor, r.nao_se_aplica)}</strong>{" "}
                      <span className="field-hint">confiança {ROTULO_CONFIANCA[r.confianca] ?? r.confianca}</span>
                      {r.trecho && <span className="deep-trecho">“{r.trecho}”</span>}
                      {r.participante && <span className="field-hint deep-detalhe">Respondeu: {r.participante}</span>}
                    </p>
                  ) : gatilho === "inativo" ? (
                    <p className="field-hint">Não se aplica pela resposta de {p.gatilho?.pergunta}.</p>
                  ) : gatilho === "aguardando" ? (
                    <p className="field-hint">Espera a resposta de {p.gatilho?.pergunta}.</p>
                  ) : null}
                  {aberta && (
                    <details className="deep-corrigir">
                      <summary>{r ? "Corrigir" : "Registrar à mão"}</summary>
                      <FormCorrecao deepId={id} sessaoId={sessaoId} p={p} r={r} />
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="field-hint">
            O agente pode registrar respostas de outras áreas quando aparecem na conversa. Todas ficam no{" "}
            <Link href={`/deep/${id}`}>painel do Deep</Link>.
          </p>
        </aside>
      </div>
    </main>
  );
}

/** Correção manual de uma resposta: grava uma versão nova, a anterior fica no histórico. */
function FormCorrecao({ deepId, sessaoId, p, r }: { deepId: string; sessaoId: string; p: PerguntaDeep; r: Resposta | undefined }) {
  const campo = `valor-${p.id}`;
  const atual = r && !r.nao_se_aplica ? r.valor : undefined;
  return (
    <AcaoForm
      action={corrigirResposta}
      campos={{ deepId, sessaoId, perguntaId: p.id }}
      rotulo="Gravar"
      rotuloEnviando="Gravando…"
      className="acao-form acao-form-coluna"
    >
      {p.tipo === "multipla" ? (
        <fieldset className="deep-opcoes">
          <legend>Opções</legend>
          {p.opcoes?.map((o) => (
            <label key={o}>
              <input type="checkbox" name="opcoes" value={o} defaultChecked={Array.isArray(atual) && atual.includes(o)} /> {rotuloOpcao(o)}
            </label>
          ))}
        </fieldset>
      ) : p.tipo === "opcao" || p.tipo === "sim_nao" ? (
        <div className="field">
          <label htmlFor={campo}>Resposta</label>
          <select id={campo} name="texto" defaultValue={atual === undefined ? "" : valorParaCampo(p, atual)}>
            <option value="">Escolha</option>
            {(p.tipo === "sim_nao" ? ["sim", "nao"] : (p.opcoes ?? [])).map((o) => (
              <option key={o} value={o}>
                {o === "nao" ? "não" : rotuloOpcao(o)}
              </option>
            ))}
          </select>
        </div>
      ) : p.tipo === "texto" ? (
        <div className="field">
          <label htmlFor={campo}>Resposta</label>
          <textarea id={campo} name="texto" rows={3} maxLength={2000} defaultValue={atual === undefined ? "" : valorParaCampo(p, atual)} />
        </div>
      ) : (
        <div className="field">
          <label htmlFor={campo}>
            Resposta {p.tipo === "moeda" ? "(R$)" : p.tipo === "percentual" ? "(%)" : p.unidade ? `(${p.unidade})` : ""}
          </label>
          <input id={campo} name="texto" inputMode="decimal" maxLength={30} defaultValue={atual === undefined ? "" : valorParaCampo(p, atual)} />
        </div>
      )}
      <label className="deep-check">
        <input type="checkbox" name="naoSeAplica" defaultChecked={r?.nao_se_aplica ?? false} /> Não se aplica
      </label>
      <div className="field">
        <label htmlFor={`confianca-${p.id}`}>Confiança</label>
        <select id={`confianca-${p.id}`} name="confianca" defaultValue={r?.confianca ?? "media"}>
          <option value="alta">Alta (relatório ou sistema)</option>
          <option value="media">Média (de cabeça, com segurança)</option>
          <option value="baixa">Baixa (estimativa)</option>
        </select>
      </div>
    </AcaoForm>
  );
}
