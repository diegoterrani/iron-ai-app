"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { AcaoState } from "@/lib/acao/tipos";
import type { FalaReuniao } from "@/lib/assessment/deep/tela";
import { encerrarReuniao, falarNaReuniao, type EntradaReuniao } from "../../../actions";

/**
 * Conversa da reunião em modo analista: o analista digita o que os
 * participantes responderam e o agente grava e devolve a próxima pergunta.
 * Sem animação de digitação: na reunião, a próxima pergunta precisa
 * aparecer inteira e logo. Tudo é texto puro (nada vira HTML).
 */

interface Props {
  deepId: string;
  sessaoId: string;
  falasIniciais: FalaReuniao[];
  /** Reunião aberta e agente disponível: mostra a caixa de texto. */
  aberta: boolean;
  /** Reunião aberta (mesmo sem agente): permite encerrar com resumo. */
  podeEncerrar: boolean;
  maxTexto: number;
}

/** Fala na tela, com o aviso do app sobre o que o turno gravou. */
type Fala = FalaReuniao & { aviso?: string };

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

export function ReuniaoDeep({ deepId, sessaoId, falasIniciais, aberta, podeEncerrar, maxTexto }: Props) {
  const [falas, setFalas] = useState<Fala[]>(falasIniciais);
  const [texto, setTexto] = useState("");
  const [aguardando, setAguardando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const iniciou = useRef(false);

  const enviar = async (e: EntradaReuniao, fala?: Fala): Promise<boolean> => {
    setErro(null);
    setAguardando(true);
    if (fala) setFalas((f) => [...f, fala]);
    try {
      const r = await falarNaReuniao(deepId, sessaoId, e);
      if (!r.ok) {
        // A fala não foi gravada: sai da tela e volta para a caixa de texto.
        if (fala) setFalas((f) => f.slice(0, -1));
        setErro(r.erro ?? "Não foi possível continuar.");
        return false;
      }
      const partes: string[] = [];
      if (r.mascarados) partes.push(`${plural(r.mascarados, "dado sensível removido", "dados sensíveis removidos")} da sua fala antes de ir ao agente`);
      const g = r.gravou;
      if (g && g.respostas + g.evidencias + g.pendencias > 0) {
        const itens = [
          g.respostas && plural(g.respostas, "resposta", "respostas"),
          g.evidencias && plural(g.evidencias, "evidência", "evidências"),
          g.pendencias && plural(g.pendencias, "pendência", "pendências"),
        ].filter(Boolean);
        partes.push(`gravado: ${itens.join(", ")}`);
      }
      // O aviso (o que foi gravado ou mascarado) aparece abaixo da última fala do agente.
      const novas: Fala[] = (r.falas ?? []).map((f, i, todas) =>
        i === todas.length - 1 && partes.length > 0 ? { ...f, aviso: partes.join("; ") + "." } : f,
      );
      setFalas((f) => [...f, ...novas]);
      if (r.resumo !== undefined) setResumo(r.resumo);
      return true;
    } catch {
      if (fala) setFalas((f) => f.slice(0, -1));
      setErro("Sem conexão com o servidor. Confira a internet e tente de novo.");
      return false;
    } finally {
      setAguardando(false);
      requestAnimationFrame(() => entrada.current?.focus());
    }
  };

  // Reunião nova: o agente se apresenta e traz a primeira pergunta.
  useEffect(() => {
    if (iniciou.current || !aberta || falasIniciais.length > 0) return;
    iniciou.current = true;
    void enviar({ tipo: "inicio" });
    // Roda uma vez na abertura; enviar não muda o que a abertura faz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, falasIniciais.length]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [falas, aguardando, resumo, erro]);

  const aoEnviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const t = texto.trim();
    if (!t || aguardando) return;
    setTexto("");
    const ok = await enviar({ tipo: "mensagem", texto: t }, { autor: "analista", texto: t });
    if (!ok) setTexto(t);
  };

  const [estadoEncerrar, encerrar, encerrando] = useActionState<AcaoState, FormData>(encerrarReuniao, {});

  return (
    <section className="conversa conversa-reuniao" aria-label="Conversa com o agente">
      <div className="conversa-falas" role="log" aria-live="polite" aria-relevant="additions">
        {falas.length === 0 && !aguardando && <p className="field-hint">Nenhuma fala registrada nesta reunião.</p>}
        {falas.map((f, i) => (
          <div key={i} className="deep-fala-bloco">
            <div className={f.autor === "agente" ? "fala fala-agente" : "fala fala-cliente"}>
              <span className="sr-only">{f.autor === "agente" ? "Agente:" : "Você:"}</span>
              <TextoFala texto={f.texto} />
            </div>
            {f.aviso && (
              <p className="deep-aviso" role="status">
                {f.aviso}
              </p>
            )}
          </div>
        ))}
        {aguardando && (
          <p className="fala fala-agente fala-pensando" aria-label="O agente está registrando">
            Registrando…
          </p>
        )}

        {resumo !== null && podeEncerrar && (
          <form action={encerrar} className="resumo-conversa">
            <h2 className="pergunta-titulo">Encerrar a reunião</h2>
            <input type="hidden" name="deepId" value={deepId} />
            <input type="hidden" name="sessaoId" value={sessaoId} />
            <div className="field">
              <label htmlFor="resumo">Resumo (vai como contexto das próximas reuniões)</label>
              <textarea id="resumo" name="resumo" rows={10} maxLength={20000} value={resumo} onChange={(e) => setResumo(e.target.value)} />
            </div>
            <p className="field-hint">Revise antes de gravar: depois de encerrada, a reunião não recebe novas falas.</p>
            <div className="acoes">
              <button type="submit" className="btn btn-inline" disabled={encerrando || !resumo.trim()}>
                {encerrando ? "Encerrando…" : "Gravar resumo e encerrar"}
              </button>
              <button type="button" className="btn btn-inline btn-secondary" onClick={() => setResumo(null)} disabled={encerrando}>
                Continuar a reunião
              </button>
            </div>
            {estadoEncerrar.message && (
              <p className="field-error" role="alert">
                {estadoEncerrar.message}
              </p>
            )}
          </form>
        )}
        <div ref={fim} />
      </div>

      {erro && (
        <p className="field-error" role="alert">
          {erro}
        </p>
      )}

      {aberta && resumo === null && (
        <form className="conversa-entrada" onSubmit={aoEnviar}>
          <label htmlFor="fala-analista" className="sr-only">
            O que os participantes responderam
          </label>
          <textarea
            id="fala-analista"
            ref={entrada}
            rows={3}
            maxLength={maxTexto}
            value={texto}
            placeholder="Digite o que foi respondido (pode trazer várias respostas de uma vez)"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envia; Shift+Enter quebra a linha.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" className="btn btn-inline" disabled={aguardando || !texto.trim()}>
            Enviar
          </button>
        </form>
      )}

      {podeEncerrar && resumo === null && (
        <div className="acoes">
          {aberta && (
            <button type="button" className="btn btn-inline btn-secondary" disabled={aguardando} onClick={() => void enviar({ tipo: "encerrar" })}>
              Encerrar: pedir o resumo ao agente
            </button>
          )}
          <button type="button" className="btn btn-inline btn-secondary" disabled={aguardando} onClick={() => setResumo("")}>
            Encerrar com resumo próprio
          </button>
        </div>
      )}
      {aberta && (
        <p className="field-hint">
          Enter envia, Shift+Enter quebra a linha. CPF, CNPJ, cartão e dados bancários são removidos antes de ir ao agente.
        </p>
      )}
    </section>
  );
}

/** Texto de uma fala em parágrafos, só texto puro. */
function TextoFala({ texto }: { texto: string }) {
  return (
    <>
      {texto
        .split("\n")
        .filter((l) => l.trim())
        .map((l, i) => (
          <p key={i}>{l}</p>
        ))}
    </>
  );
}
