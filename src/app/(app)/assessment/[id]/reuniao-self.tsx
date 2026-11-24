"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Questionario06, Rascunho06 } from "@/lib/assessment/v06/questionario";
import { contagemDaReuniao, perguntasDaReuniao, type PerguntaReuniao } from "@/lib/assessment/v06/reuniao";
import { TEXTO_CONSENTIMENTO } from "@/lib/escuta/config";
import { ConexaoEscuta, suportaEscuta, type CanalAudio } from "@/lib/escuta/navegador";
import {
  compilarReuniao,
  consentirEscuta,
  definirModoEscuta,
  guardarFalaReuniao,
  lerReuniao,
  resolverEscuta,
  tokenEscuta,
  type EstadoEscutaTela,
} from "../escuta-actions";

/**
 * Modo reunião (pedido do Terrani, 24/11/2026): a lista de todas as
 * perguntas fica à vista e a captação corre a reunião inteira, sem parar a
 * cada pergunta. A fala vai sendo guardada em trechos no servidor (mascarada,
 * como o aviso de consentimento diz), então recarregar a página não perde a
 * reunião. No fim, "Encerrar e compilar" lê a reunião inteira e preenche o
 * Self pelo contexto; o que veio com dúvida fica para confirmar. A revisão e
 * o relatório seguem pelo formulário, com o mesmo cálculo dos outros modos.
 */

interface Props {
  assessmentId: string;
  questionario: Questionario06;
  inicial: Rascunho06;
}

type Etapa = "carregando" | "fechado" | "aviso" | "ativo";

interface Bloco {
  seq: number;
  canal: "sala" | "remoto";
  texto: string;
}

/** Junta a fala em trechos de até ~1.200 caracteres ou 15 s antes de guardar. */
const TAMANHO_TRECHO = 1200;
const INTERVALO_ENVIO_MS = 15_000;
const POR_ENVIO = 20;
const MAX_LINHAS_TELA = 60;
const ANTECEDENCIA_RENOVAR_S = 60;

const CANAL: Record<CanalAudio, Bloco["canal"]> = { microfone: "sala", aba: "remoto" };

function msParaRenovar(exp: number): number {
  return Math.max(5_000, (exp - ANTECEDENCIA_RENOVAR_S) * 1000 - Date.now());
}

const ROTULO_SITUACAO: Record<PerguntaReuniao["situacao"], string> = {
  respondida: "Respondida",
  a_confirmar: "A confirmar",
  pendente: "Em aberto",
};

export function ReuniaoSelf({ assessmentId, questionario: q, inicial }: Props) {
  const [respostas, setRespostas] = useState<Rascunho06>(inicial);
  const [estado, setEstado] = useState<EstadoEscutaTela | null>(null);
  const [disponivel, setDisponivel] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("carregando");
  const [pessoas, setPessoas] = useState(2);
  const [concordo, setConcordo] = useState(false);
  const [conectada, setConectada] = useState(false);
  const [canais, setCanais] = useState<CanalAudio[]>([]);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [parcial, setParcial] = useState("");
  const [guardados, setGuardados] = useState(0);
  const [aEnviar, setAEnviar] = useState(0);
  const [trabalhando, setTrabalhando] = useState(false);
  const [compilando, setCompilando] = useState(false);
  const [resultado, setResultado] = useState<{ gravados: number; propostas: number; cortado: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [suporte] = useState(suportaEscuta);

  const conexao = useRef<ConexaoEscuta | null>(null);
  const renovacao = useRef<number | null>(null);
  const parando = useRef(false);
  const seq = useRef(0);
  const buffer = useRef<{ canal: Bloco["canal"]; texto: string } | null>(null);
  const fila = useRef<Bloco[]>([]);
  const enviando = useRef<Promise<boolean> | null>(null);
  const fimDaLista = useRef<HTMLDivElement>(null);

  const lista = useMemo(() => perguntasDaReuniao(q, respostas, estado?.aConfirmar.map((i) => i.campo) ?? []), [q, respostas, estado]);
  const contagem = contagemDaReuniao(lista);

  // ------------------------------------------------------------ fila de trechos

  /** Fecha o trecho em formação e põe na fila (cada trecho ganha o próximo número). */
  const fecharTrecho = useCallback(() => {
    const b = buffer.current;
    buffer.current = null;
    if (!b || !b.texto.trim()) return;
    seq.current += 1;
    fila.current.push({ seq: seq.current, canal: b.canal, texto: b.texto.trim().slice(0, 4000) });
    setAEnviar(fila.current.length);
  }, []);

  /** Manda a fila ao servidor, até 20 por vez. Falhou: os trechos ficam e vão no próximo envio. */
  const enviarFila = useCallback(async (): Promise<boolean> => {
    if (enviando.current) return enviando.current;
    const tarefa = (async () => {
      while (fila.current.length > 0) {
        const lote = fila.current.slice(0, POR_ENVIO);
        const r = await guardarFalaReuniao(assessmentId, lote).catch(() => null);
        if (!r || !r.ok) {
          setAviso(r && !r.ok ? r.erro : "Sem conexão com o servidor. A captação continua e tenta de novo.");
          return false;
        }
        fila.current = fila.current.slice(lote.length);
        setGuardados((n) => n + lote.length);
        setAEnviar(fila.current.length);
      }
      setAviso(null);
      return true;
    })();
    enviando.current = tarefa;
    try {
      return await tarefa;
    } finally {
      enviando.current = null;
    }
  }, [assessmentId]);

  const aoFinal = useCallback(
    (canal: CanalAudio, texto: string) => {
      // Depois de pausar ou encerrar, fala que ainda chegue do socket não entra.
      if (parando.current) return;
      const c = CANAL[canal];
      setParcial("");
      setLinhas((l) => [...l, texto].slice(-MAX_LINHAS_TELA));
      if (buffer.current && buffer.current.canal !== c) fecharTrecho();
      buffer.current = { canal: c, texto: buffer.current ? `${buffer.current.texto} ${texto}` : texto };
      if (buffer.current.texto.length >= TAMANHO_TRECHO) {
        fecharTrecho();
        void enviarFila();
      }
    },
    [fecharTrecho, enviarFila],
  );

  // A cada 15 s o que foi dito vai para o servidor, mesmo em trecho curto.
  useEffect(() => {
    if (etapa !== "ativo") return;
    const t = window.setInterval(() => {
      fecharTrecho();
      void enviarFila();
    }, INTERVALO_ENVIO_MS);
    return () => window.clearInterval(t);
  }, [etapa, fecharTrecho, enviarFila]);

  // Aviso ao fechar a aba com fala ainda não guardada.
  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => {
      if (fila.current.length > 0 || buffer.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, []);

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ block: "nearest" });
  }, [linhas, parcial]);

  // ------------------------------------------------------------ abertura

  useEffect(() => {
    void (async () => {
      const r = await lerReuniao(assessmentId).catch(() => null);
      if (!r || !r.ok) {
        setErro(r && !r.ok ? r.erro : "Não foi possível abrir a reunião.");
        setEtapa("fechado");
        return;
      }
      setEstado(r.estado);
      setDisponivel(r.disponivel);
      seq.current = r.ultimoSeq;
      setGuardados(r.blocos);
      setEtapa("fechado");
    })();
  }, [assessmentId]);

  useEffect(
    () => () => {
      conexao.current?.fechar();
      if (renovacao.current) window.clearTimeout(renovacao.current);
    },
    [],
  );

  // ------------------------------------------------------------ áudio

  const renovarDepois = (exp: number) => {
    if (renovacao.current) window.clearTimeout(renovacao.current);
    renovacao.current = window.setTimeout(async () => {
      const t = await tokenEscuta(assessmentId).catch(() => null);
      if (!t || !t.ok) {
        setAviso(t && !t.ok ? t.erro : "Não foi possível renovar o áudio.");
        return;
      }
      setEstado((e) => (e ? { ...e, minutosRestantes: t.minutosRestantes } : e));
      conexao.current?.renovar(t.token);
      renovarDepois(t.exp);
    }, msParaRenovar(exp));
  };

  const conectar = async (): Promise<boolean> => {
    setErro(null);
    const t = await tokenEscuta(assessmentId);
    if (!t.ok) {
      setErro(t.erro);
      return false;
    }
    setEstado((e) => (e ? { ...e, minutosRestantes: t.minutosRestantes } : e));
    parando.current = false;
    const c = new ConexaoEscuta(t.endereco, t.protocolo, t.token, {
      aoAbrir: () => setConectada(true),
      aoParcial: (_canal, texto) => setParcial(texto),
      aoFinal: (canal, texto) => aoFinal(canal, texto),
      aoErro: (codigo) => {
        if (codigo === "stt_reconectando") return;
        if (codigo === "renovacao_recusada") setAviso("A renovação do áudio foi recusada; ele vai parar em instantes.");
        else if (codigo === "conexao") setAviso("Falha na conexão do áudio.");
      },
      aoFechar: (codigo) => {
        setConectada(false);
        setCanais([]);
        if (renovacao.current) window.clearTimeout(renovacao.current);
        conexao.current = null;
        fecharTrecho();
        void enviarFila();
        if (parando.current) return;
        setAviso(
          codigo === 4003
            ? "O áudio parou: o tempo reservado acabou."
            : codigo === 4001
              ? "O áudio foi aberto em outra aba."
              : "A conexão do áudio caiu. O que já foi dito está guardado; conecte de novo para continuar.",
        );
      },
    });
    conexao.current = c;
    renovarDepois(t.exp);
    try {
      await c.adicionarMicrofone();
      c.transmitir("microfone", true);
      setCanais(c.canais());
      return true;
    } catch {
      c.fechar();
      conexao.current = null;
      setErro("O navegador não liberou o microfone. Permita o acesso ao microfone e tente de novo.");
      return false;
    }
  };

  const desconectar = () => {
    parando.current = true;
    conexao.current?.fechar();
    conexao.current = null;
    setConectada(false);
    setCanais([]);
    setParcial("");
    if (renovacao.current) window.clearTimeout(renovacao.current);
  };

  /** Liga a captação: com consentimento vigente, só troca o modo; senão, abre o aviso. */
  const comecar = async () => {
    const consentimentoValido = estado?.validoAte ? new Date(estado.validoAte).getTime() > Date.now() : false;
    if (!consentimentoValido) return setEtapa("aviso");
    setTrabalhando(true);
    const m = await definirModoEscuta(assessmentId, "fluido");
    if (!m.ok) {
      setTrabalhando(false);
      if (m.erro.includes("consentimento")) return setEtapa("aviso");
      return setErro(m.erro);
    }
    setEstado(m.estado);
    const ok = await conectar();
    setTrabalhando(false);
    if (ok) setEtapa("ativo");
  };

  const registrarAviso = async () => {
    setTrabalhando(true);
    setErro(null);
    const r = await consentirEscuta(assessmentId, pessoas);
    if (!r.ok) {
      setTrabalhando(false);
      return setErro(r.erro);
    }
    const m = await definirModoEscuta(assessmentId, "fluido");
    if (!m.ok) {
      setTrabalhando(false);
      return setErro(m.erro);
    }
    setEstado(m.estado);
    const ok = await conectar();
    setTrabalhando(false);
    if (ok) setEtapa("ativo");
  };

  const pausar = async () => {
    desconectar();
    fecharTrecho();
    await enviarFila();
    setEtapa("fechado");
  };

  const adicionarAba = async () => {
    const c = conexao.current;
    if (!c) return;
    try {
      const ok = await c.adicionarAba();
      if (!ok) return setAviso('Escolha a aba da chamada e marque "Compartilhar áudio da aba".');
      c.transmitir("aba", true);
      setCanais(c.canais());
    } catch {
      setAviso("O compartilhamento da aba foi cancelado.");
    }
  };

  // ------------------------------------------------------------ compilação

  /** Encerra a captação, guarda o que falta e lê a reunião inteira. */
  const compilar = async () => {
    setErro(null);
    setAviso(null);
    desconectar();
    fecharTrecho();
    // Sai de "ativo" antes do envio final: o envio periódico para e nada entra
    // na fila depois desta foto da reunião.
    setEtapa("fechado");
    setCompilando(true);
    const guardou = await enviarFila();
    if (!guardou) {
      setCompilando(false);
      setEtapa("fechado");
      return setErro("Parte da fala ainda não foi guardada. Confira a internet e tente compilar de novo.");
    }
    const r = await compilarReuniao(assessmentId).catch(() => null);
    setCompilando(false);
    setEtapa("fechado");
    if (!r || !r.ok) return setErro(r && !r.ok ? r.erro : "Sem conexão com o servidor. A fala continua guardada; tente de novo.");
    setEstado(r.estado);
    if (r.respostas) setRespostas(r.respostas);
    setResultado({ gravados: r.gravados, propostas: r.propostas, cortado: r.cortado });
  };

  const resolver = async (item: string, decisao: "confirmar" | "descartar") => {
    setTrabalhando(true);
    const r = await resolverEscuta(assessmentId, item, decisao);
    setTrabalhando(false);
    if (!r.ok) return setAviso(r.erro);
    setEstado(r.estado);
    if (r.respostas) setRespostas(r.respostas);
  };

  // ------------------------------------------------------------ tela

  const semAudio = etapa !== "carregando" && (!disponivel || !suporte.microfone);
  const pendentesConfirmar = estado?.aConfirmar ?? [];

  return (
    <div className="conversa-dividida reuniao">
      <section className="reuniao-perguntas" aria-label="Perguntas do Self">
        <header className="reuniao-topo">
          <h2 className="pergunta-titulo">Perguntas da reunião</h2>
          <p className="field-hint" role="status">
            {contagem.respondidas} de {contagem.total} respondidas
            {contagem.aConfirmar > 0 ? ` · ${contagem.aConfirmar} a confirmar` : ""}
          </p>
        </header>
        <p className="field-hint">
          Conduza a conversa livremente. As respostas são preenchidas quando você encerrar e compilar. O cadastro da
          empresa (CNPJ, contato) é conferido no formulário, na revisão.
        </p>
        <ol className="reuniao-lista">
          {lista.map((p, i) => (
            <li key={p.campo} className={`reuniao-item reuniao-${p.situacao}`}>
              {(i === 0 || lista[i - 1].bloco !== p.bloco) && <p className="reuniao-bloco">{p.bloco}</p>}
              <p className="reuniao-pergunta">{p.pergunta}</p>
              <p className="reuniao-opcoes">{p.opcoes}</p>
              <p className="reuniao-resposta">
                <span className="reuniao-selo">{ROTULO_SITUACAO[p.situacao]}</span>
                {p.valor !== null && <span> {p.valor}</span>}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <aside className="escuta-coluna" aria-label="Captação da reunião">
        {etapa === "carregando" && <p className="field-hint">Abrindo…</p>}

        {semAudio && (
          <p className="notice" role="note">
            O áudio não está disponível neste navegador ou agora. Use a conversa ou o formulário.
          </p>
        )}

        {etapa === "aviso" && (
          <div className="escuta-cartao">
            <h2 className="pergunta-titulo">Antes de ligar o áudio, leia para todos</h2>
            {TEXTO_CONSENTIMENTO.map((t) => (
              <p key={t}>{t}</p>
            ))}
            <div className="field">
              <label htmlFor="reuniao-pessoas">Quantas pessoas estão na reunião, contando você?</label>
              <input
                id="reuniao-pessoas"
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                value={pessoas}
                onChange={(e) => setPessoas(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              />
            </div>
            <label className="escuta-check">
              <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} />
              Li o aviso para todos os presentes e todos concordaram.
            </label>
            <div className="escuta-linha">
              <button type="button" className="btn btn-inline" disabled={!concordo || trabalhando} onClick={() => void registrarAviso()}>
                {trabalhando ? "Ligando…" : "Ligar o áudio e começar"}
              </button>
              <button type="button" className="btn btn-inline btn-secondary" onClick={() => setEtapa("fechado")}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {etapa === "fechado" && !semAudio && (
          <div className="escuta-cartao">
            <h2 className="pergunta-titulo">{guardados > 0 ? "Reunião guardada" : "Captação da reunião"}</h2>
            <p className="field-hint">
              {guardados > 0
                ? `${guardados} ${guardados === 1 ? "trecho guardado" : "trechos guardados"} desta reunião.`
                : "O assistente ouve a reunião inteira, sem interromper. No fim, ele lê tudo e responde as perguntas."}
            </p>
            <div className="escuta-linha">
              <button type="button" className="btn btn-inline" disabled={trabalhando || compilando} onClick={() => void comecar()}>
                {guardados > 0 ? "Continuar a captação" : "Começar a captação"}
              </button>
              {guardados > 0 && (
                <button type="button" className="btn btn-inline btn-secondary" disabled={trabalhando || compilando} onClick={() => void compilar()}>
                  {resultado ? "Compilar de novo" : "Compilar a reunião"}
                </button>
              )}
            </div>
          </div>
        )}

        {etapa === "ativo" && (
          <>
            <div className="escuta-cabecalho">
              <p className="escuta-status" role="status">
                {conectada ? "● Ouvindo a reunião" : "Conectando…"} · {estado?.minutosRestantes ?? 0} min restantes
              </p>
              <button type="button" className="btn-link" disabled={compilando} onClick={() => void pausar()}>
                Pausar
              </button>
            </div>
            {suporte.aba && !canais.includes("aba") && (
              <div className="escuta-linha">
                <button type="button" className="btn btn-inline btn-secondary" disabled={!conectada} onClick={() => void adicionarAba()}>
                  Adicionar áudio da chamada
                </button>
              </div>
            )}
            <div className="escuta-ao-vivo" aria-live="off">
              {linhas.length === 0 && !parcial && <p className="field-hint">A fala da reunião aparece aqui.</p>}
              {linhas.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
              {parcial && <p className="escuta-parcial">{parcial}</p>}
              <div ref={fimDaLista} />
            </div>
            <p className="field-hint">
              {guardados} {guardados === 1 ? "trecho guardado" : "trechos guardados"}
              {aEnviar > 0 ? ` · ${aEnviar} aguardando envio` : ""}
            </p>
            <div className="escuta-linha">
              <button type="button" className="btn btn-inline" disabled={compilando} onClick={() => void compilar()}>
                Encerrar e compilar
              </button>
            </div>
          </>
        )}

        {compilando && (
          <p className="field-hint" role="status">
            Lendo a reunião inteira e preenchendo as respostas. Pode levar alguns minutos.
          </p>
        )}

        {resultado && !compilando && (
          <div className="escuta-cartao escuta-enviada">
            <p className="escuta-quem">Reunião compilada</p>
            <p>
              {resultado.gravados} {resultado.gravados === 1 ? "resposta preenchida" : "respostas preenchidas"}
              {resultado.propostas > 0 ? ` e ${resultado.propostas} para confirmar` : ""}. Faltam{" "}
              {contagem.total - contagem.respondidas} de {contagem.total} perguntas.
            </p>
            {resultado.cortado && <p className="field-hint">A reunião passou do tamanho máximo; o final ficou de fora da leitura.</p>}
          </div>
        )}

        {pendentesConfirmar.length > 0 && (
          <div className="escuta-cartao">
            <h2 className="pergunta-titulo">Confirme o que foi ouvido com dúvida</h2>
            <p className="field-hint">Só entra no Self o que você confirmar. O relatório sai depois que esta lista acabar.</p>
            <ul className="escuta-confirmar">
              {pendentesConfirmar.map((i) => (
                <li key={i.id}>
                  <p>
                    <strong>{i.pergunta}:</strong> {i.valor}
                  </p>
                  <p className="field-hint">
                    Motivo da dúvida: {i.motivo}
                    {i.trecho ? ` · Ouvido: "${i.trecho}"` : ""}
                  </p>
                  <div className="escuta-linha">
                    <button type="button" className="btn btn-inline" disabled={trabalhando} onClick={() => void resolver(i.id, "confirmar")}>
                      Confirmar
                    </button>
                    <button type="button" className="btn btn-inline btn-secondary" disabled={trabalhando} onClick={() => void resolver(i.id, "descartar")}>
                      Descartar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(resultado || contagem.respondidas > 0) && etapa !== "ativo" && !compilando && (
          <div className="escuta-linha">
            {pendentesConfirmar.length > 0 ? (
              <p className="field-hint">Confirme ou descarte os itens acima para revisar e gerar o relatório.</p>
            ) : (
              <Link className="btn btn-inline" href={`/assessment/${assessmentId}?modo=formulario`}>
                Revisar e gerar o relatório
              </Link>
            )}
          </div>
        )}

        {erro && (
          <p className="field-error" role="alert">
            {erro}
          </p>
        )}
        {aviso && (
          <p className="field-hint" role="status">
            {aviso}
          </p>
        )}
      </aside>
    </div>
  );
}
