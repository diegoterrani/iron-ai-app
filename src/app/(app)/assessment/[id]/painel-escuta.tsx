"use client";

import { useEffect, useRef, useState } from "react";
import type { Rascunho06 } from "@/lib/assessment/v06/questionario";
import { TEXTO_CONSENTIMENTO } from "@/lib/escuta/config";
import { textoParaEnviar } from "@/lib/escuta/consolidacao";
import { ConexaoEscuta, suportaEscuta, type CanalAudio } from "@/lib/escuta/navegador";
import {
  consentirEscuta,
  consolidarRespostaEscuta,
  definirModoEscuta,
  lerEscuta,
  resolverEscuta,
  tokenEscuta,
  type EstadoEscutaTela,
} from "../escuta-actions";

/**
 * Entrevista guiada por áudio (decisão de 21/11/2026; substitui os modos
 * pergunta a pergunta, reunião livre e os dois).
 *
 * Com o áudio ligado, a conversa se divide: à esquerda as perguntas e a caixa
 * de texto; à direita esta captação. O consultor conduz, e quando o cliente
 * termina clica em "Pergunta respondida": a fala daquela pergunta vira uma
 * resposta consolidada, que vai direto à conversa. O assistente registra,
 * confirma o que entendeu e faz a próxima pergunta, e a captação recomeça
 * (pedido do Terrani, 24/11/2026). A última resposta enviada fica à vista no
 * painel; para corrigir, o consultor escreve a correção na conversa. Se o
 * envio falhar, a resposta consolidada abre para revisão e nada se perde.
 *
 * A fala captada fica só neste navegador; o que vai ao servidor é a fala da
 * pergunta (para consolidar, sem gravar) e o texto que o consultor envia.
 * O assistente só escuta, não fala.
 */

type Etapa = "fechado" | "aviso" | "ativo";
type Fase = "captando" | "consolidando" | "revisando";

/** Última resposta enviada à conversa pela captação (para o consultor conferir). */
interface Enviada {
  texto: string;
  observacao: string | null;
}

/** Renova o token 60 s antes de vencer. */
const ANTECEDENCIA_RENOVAR_S = 60;
const MAX_FALAS = 80;

function msParaRenovar(exp: number): number {
  return Math.max(5_000, (exp - ANTECEDENCIA_RENOVAR_S) * 1000 - Date.now());
}

/** Fim da pergunta atual (onde fica a pergunta), para a coluna da captação. */
function resumoDaPergunta(texto: string | null): string | null {
  if (!texto) return null;
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length > 220 ? `…${limpo.slice(-220)}` : limpo;
}

/** Um trecho de fala captado (sem dizer quem falou). */
interface Linha {
  texto: string;
}

interface Props {
  assessmentId: string;
  /** Última fala do assistente (a pergunta em aberto). */
  perguntaAtual: string | null;
  /** O áudio ligou ou desligou: a conversa divide ou junta a tela. */
  aoMudarAtivo: (ativo: boolean) => void;
  /** Resposta revisada vai à conversa como fala do cliente. */
  enviarVoz: (texto: string) => Promise<boolean>;
  /** Itens antigos "a confirmar" gravados no rascunho. */
  aoRespostas: (respostas: Rascunho06, versao: string) => void;
  /** A conversa está esperando o assistente. */
  ocupado: boolean;
}

export function PainelEscuta({ assessmentId, perguntaAtual, aoMudarAtivo, enviarVoz, aoRespostas, ocupado }: Props) {
  const [estado, setEstado] = useState<EstadoEscutaTela | null>(null);
  const [disponivel, setDisponivel] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("fechado");
  const [pessoas, setPessoas] = useState(2);
  const [concordo, setConcordo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [conectada, setConectada] = useState(false);
  const [canais, setCanais] = useState<CanalAudio[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [parcial, setParcial] = useState("");
  const [fase, setFase] = useState<Fase>("captando");
  const [rascunho, setRascunho] = useState("");
  const [observacao, setObservacao] = useState<string | null>(null);
  const [enviada, setEnviada] = useState<Enviada | null>(null);
  const [suporte] = useState(suportaEscuta);

  const conexao = useRef<ConexaoEscuta | null>(null);
  const renovacao = useRef<number | null>(null);
  const parando = useRef(false);
  const fimDaLista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const r = await lerEscuta(assessmentId);
      if (!r.ok) return;
      setEstado(r.estado);
      setDisponivel(r.disponivel);
    })();
  }, [assessmentId]);

  useEffect(
    () => () => {
      conexao.current?.fechar();
      if (renovacao.current) window.clearTimeout(renovacao.current);
    },
    [],
  );

  // A captação acompanha a fala mais recente.
  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ block: "nearest" });
  }, [linhas, parcial]);

  const ativar = (ativo: boolean, proxima: Etapa) => {
    setEtapa(proxima);
    aoMudarAtivo(ativo);
  };

  // ------------------------------------------------------------ conexão

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
    setAviso(null);
    const t = await tokenEscuta(assessmentId);
    if (!t.ok) {
      setErro(t.erro);
      return false;
    }
    setEstado((e) => (e ? { ...e, minutosRestantes: t.minutosRestantes } : e));
    parando.current = false;
    const c = new ConexaoEscuta(t.endereco, t.protocolo, t.token, {
      aoAbrir: () => setConectada(true),
      // Quem fala não importa (decisão de 24/11/2026): a captação junta tudo o
      // que foi dito sobre a pergunta e o consolidador tira a resposta do conteúdo.
      aoParcial: (_canal, texto) => setParcial(texto),
      aoFinal: (_canal, texto) => {
        setParcial("");
        setLinhas((l) => [...l, { texto }].slice(-MAX_FALAS));
      },
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
        if (parando.current) return;
        setAviso(
          codigo === 4003
            ? "O áudio parou: o tempo reservado acabou."
            : codigo === 4001
              ? "O áudio foi aberto em outra aba."
              : "A conexão do áudio caiu.",
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
    if (renovacao.current) window.clearTimeout(renovacao.current);
  };

  // ------------------------------------------------------------ ações

  const registrarAviso = async () => {
    setTrabalhando(true);
    setErro(null);
    const r = await consentirEscuta(assessmentId, pessoas);
    if (!r.ok) {
      setTrabalhando(false);
      return setErro(r.erro);
    }
    const m = await definirModoEscuta(assessmentId, "pergunta");
    if (!m.ok) {
      setTrabalhando(false);
      return setErro(m.erro);
    }
    setEstado(m.estado);
    const ok = await conectar();
    setTrabalhando(false);
    if (ok) setEtapa("ativo");
  };

  /** Reabre com o consentimento ainda válido (ex.: depois de recarregar a página). */
  const reconectar = async () => {
    setTrabalhando(true);
    const ok = await conectar();
    setTrabalhando(false);
    if (ok) ativar(true, "ativo");
  };

  const desligar = async () => {
    desconectar();
    const r = await definirModoEscuta(assessmentId, "desligada");
    if (r.ok) setEstado(r.estado);
    setLinhas([]);
    setParcial("");
    setFase("captando");
    setRascunho("");
    ativar(false, "fechado");
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

  /** "Pergunta respondida": a fala desta pergunta vira a resposta consolidada. */
  const consolidar = async () => {
    const trechos = parcial.trim() ? [...linhas, { texto: parcial.trim() }] : linhas;
    // Sem papel de quem fala: tudo vai como fala da sala, na ordem em que foi dito.
    const falas = trechos.map((l) => ({ quem: "Sala", texto: l.texto }));
    if (falas.length === 0) return setAviso("Nada foi captado ainda para esta pergunta.");
    setAviso(null);
    setFase("consolidando");
    const r = await consolidarRespostaEscuta(assessmentId, perguntaAtual ?? "", falas);
    if (!r.ok) {
      setFase("captando");
      return setAviso(r.erro);
    }
    const texto = textoParaEnviar(r.consolidada).trim();
    if (!texto) {
      setFase("captando");
      return setAviso("Não deu para tirar uma resposta da fala captada. Peça para o cliente responder de novo.");
    }
    // Envio direto: o assistente registra, confirma e já faz a próxima pergunta.
    const ok = await enviarVoz(texto);
    if (!ok) {
      // Falhou (rede, limite, conflito): a resposta abre para revisão e reenvio.
      setRascunho(texto);
      setObservacao(r.consolidada.observacao);
      setFase("revisando");
      return;
    }
    setEnviada({ texto, observacao: r.consolidada.observacao });
    responderDeNovo();
  };

  const responderDeNovo = () => {
    setLinhas([]);
    setParcial("");
    setRascunho("");
    setObservacao(null);
    setFase("captando");
  };

  const enviarEseguir = async () => {
    const texto = rascunho.trim();
    if (!texto) return setAviso("A resposta está vazia. Responda de novo por áudio ou escreva a resposta.");
    setTrabalhando(true);
    const ok = await enviarVoz(texto);
    setTrabalhando(false);
    if (!ok) return;
    setEnviada({ texto, observacao });
    // Próxima pergunta: a captação recomeça do zero.
    responderDeNovo();
  };

  const resolver = async (item: string, decisao: "confirmar" | "descartar") => {
    setTrabalhando(true);
    const r = await resolverEscuta(assessmentId, item, decisao);
    setTrabalhando(false);
    if (!r.ok) return setAviso(r.erro);
    setEstado(r.estado);
    if (r.respostas && r.versao) aoRespostas(r.respostas, r.versao);
  };

  // ------------------------------------------------------------ tela

  const confirmar =
    estado && estado.aConfirmar.length > 0 ? <ListaConfirmar estado={estado} resolver={resolver} ocupado={trabalhando} /> : null;
  if (!estado || !disponivel || !suporte.microfone) return confirmar;

  if (etapa === "fechado") {
    const ligado = estado.modo !== "desligada";
    return (
      <div className="escuta-barra">
        {ligado ? (
          <>
            <span className="field-hint">O áudio está ligado, mas o microfone não está conectado.</span>
            <button type="button" className="btn btn-inline" disabled={trabalhando} onClick={() => void reconectar()}>
              Conectar microfone
            </button>
            <button type="button" className="btn btn-inline btn-secondary" disabled={trabalhando} onClick={() => void desligar()}>
              Desligar áudio
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-inline btn-secondary" onClick={() => ativar(true, "aviso")}>
            Ativar assistente de áudio
          </button>
        )}
        {erro && (
          <p className="field-error" role="alert">
            {erro}
          </p>
        )}
        {confirmar}
      </div>
    );
  }

  if (etapa === "aviso") {
    return (
      <aside className="escuta-coluna" aria-label="Assistente de áudio">
        <div className="escuta-cartao">
          <h2 className="pergunta-titulo">Antes de ligar o áudio, leia para todos</h2>
          {TEXTO_CONSENTIMENTO.map((t) => (
            <p key={t}>{t}</p>
          ))}
          <div className="field">
            <label htmlFor="escuta-pessoas">Quantas pessoas estão na reunião, contando você?</label>
            <input
              id="escuta-pessoas"
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
              {trabalhando ? "Ligando…" : "Ligar o áudio"}
            </button>
            <button type="button" className="btn btn-inline btn-secondary" onClick={() => ativar(false, "fechado")}>
              Cancelar
            </button>
          </div>
          {erro && (
            <p className="field-error" role="alert">
              {erro}
            </p>
          )}
        </div>
      </aside>
    );
  }

  const pergunta = resumoDaPergunta(perguntaAtual);
  return (
    <aside className="escuta-coluna" aria-label="Captação da conversa">
      <div className="escuta-cabecalho">
        <p className="escuta-status" role="status">
          {conectada ? "● Ouvindo" : "Conectando…"} · {estado.minutosRestantes} min restantes
        </p>
        <button type="button" className="btn-link" disabled={trabalhando} onClick={() => void desligar()}>
          Desligar áudio
        </button>
      </div>

      <div className="escuta-linha">
        {suporte.aba && !canais.includes("aba") && (
          <button type="button" className="btn btn-inline btn-secondary" disabled={!conectada} onClick={() => void adicionarAba()}>
            Adicionar áudio da chamada
          </button>
        )}
      </div>

      {pergunta && (
        <p className="escuta-pergunta">
          <span className="escuta-quem">Pergunta:</span> {pergunta}
        </p>
      )}

      <div className="escuta-ao-vivo" aria-live="off">
        {linhas.length === 0 && !parcial && <p className="field-hint">A fala desta pergunta aparece aqui.</p>}
        {linhas.map((l, i) => (
          <p key={i}>{l.texto}</p>
        ))}
        {parcial && <p className="escuta-parcial">{parcial}</p>}
        <div ref={fimDaLista} />
      </div>

      {fase === "captando" && (
        <div className="escuta-linha">
          <button type="button" className="btn btn-inline" disabled={ocupado || (linhas.length === 0 && !parcial)} onClick={() => void consolidar()}>
            Pergunta respondida
          </button>
          {linhas.length > 0 && (
            <button type="button" className="btn btn-inline btn-secondary" onClick={responderDeNovo}>
              Limpar captação
            </button>
          )}
        </div>
      )}

      {fase === "consolidando" && (
        <p className="field-hint" role="status">
          Organizando a resposta e registrando no Self…
        </p>
      )}

      {enviada && fase === "captando" && (
        <div className="escuta-cartao escuta-enviada">
          <p className="escuta-quem">Resposta registrada na conversa</p>
          <p className="escuta-enviada-texto">{enviada.texto}</p>
          {enviada.observacao && <p className="field-hint">Atenção: {enviada.observacao}</p>}
          <p className="field-hint">Se algo saiu errado, escreva a correção na caixa da conversa.</p>
        </div>
      )}

      {fase === "revisando" && (
        <div className="escuta-cartao escuta-revisao">
          <label htmlFor="escuta-resposta" className="pergunta-titulo">
            Resposta consolidada
          </label>
          <textarea id="escuta-resposta" rows={6} maxLength={4000} value={rascunho} onChange={(e) => setRascunho(e.target.value)} />
          {observacao && <p className="field-hint">Atenção: {observacao}</p>}
          <p className="field-hint">O envio automático falhou. Confira o texto e envie de novo.</p>
          <div className="escuta-linha">
            <button
              type="button"
              className="btn btn-inline"
              disabled={ocupado || trabalhando || !rascunho.trim()}
              onClick={() => void enviarEseguir()}
            >
              {trabalhando ? "Enviando…" : "Enviar de novo"}
            </button>
            <button type="button" className="btn btn-inline btn-secondary" disabled={trabalhando} onClick={responderDeNovo}>
              Responder de novo por áudio
            </button>
          </div>
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
      {confirmar}
    </aside>
  );
}

function ListaConfirmar({
  estado,
  resolver,
  ocupado,
}: {
  estado: EstadoEscutaTela;
  resolver: (item: string, decisao: "confirmar" | "descartar") => Promise<void>;
  ocupado: boolean;
}) {
  return (
    <div className="escuta-cartao">
      <h2 className="pergunta-titulo">Respostas ouvidas para confirmar</h2>
      <p className="field-hint">Ficaram de uma escuta anterior. Elas só entram no Self se você confirmar.</p>
      <ul className="escuta-confirmar">
        {estado.aConfirmar.map((i) => (
          <li key={i.id}>
            <p>
              <strong>{i.pergunta}:</strong> {i.valor}
            </p>
            <p className="field-hint">
              Motivo da dúvida: {i.motivo}
              {i.trecho ? ` · Ouvido: "${i.trecho}"` : ""}
            </p>
            <div className="escuta-linha">
              <button type="button" className="btn btn-inline" disabled={ocupado} onClick={() => void resolver(i.id, "confirmar")}>
                Confirmar
              </button>
              <button type="button" className="btn btn-inline btn-secondary" disabled={ocupado} onClick={() => void resolver(i.id, "descartar")}>
                Descartar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
