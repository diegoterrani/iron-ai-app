"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Rascunho06 } from "@/lib/assessment/v06/questionario";
import { TEXTO_CONSENTIMENTO } from "@/lib/escuta/config";
import { ConexaoEscuta, suportaEscuta, type CanalAudio } from "@/lib/escuta/navegador";
import { canalDoBloco, proximoSeq, rotularBloco, type Papeis } from "@/lib/escuta/papeis";
import {
  consentirEscuta,
  definirModoEscuta,
  enviarBlocosEscuta,
  lerEscuta,
  processarEscuta,
  resolverEscuta,
  tokenEscuta,
  type EstadoEscutaTela,
} from "../escuta-actions";

/**
 * Áudio opcional na conversa do Self (o assistente só escuta, não fala).
 *
 * - Pergunta a pergunta: "Responder falando" grava a resposta e a envia à
 *   conversa como se tivesse sido digitada.
 * - Fluido: escuta contínua da reunião; um agente separado tira da fala as
 *   respostas do Self. "Sou eu" marca a voz do consultor na sala; em reunião
 *   por chamada, o microfone é o consultor e a aba é o cliente.
 * - Ambos: a escuta contínua segue enquanto a conversa por texto continua.
 *
 * Ligar exige o aviso lido para todos e registrado no banco. O áudio vai
 * direto ao Worker de transcrição; esta tela só manda texto ao servidor.
 */

type Modo = "pergunta" | "fluido" | "ambos";
type Etapa = "fechado" | "aviso" | "modo" | "ativo";

const ROTULO_MODO: Record<Modo, { nome: string; descricao: string }> = {
  pergunta: { nome: "Pergunta a pergunta", descricao: "O assistente pergunta na tela e a resposta é dada falando." },
  fluido: { nome: "Reunião livre", descricao: "A conversa corre livre e o assistente tira dela as respostas." },
  ambos: { nome: "Os dois", descricao: "Escuta a reunião enquanto a conversa por texto continua." },
};

/** Processa a transcrição quando juntar 3 blocos ou 30 s depois do primeiro novo. */
const BLOCOS_PARA_PROCESSAR = 3;
const ESPERA_PROCESSAR_MS = 30_000;
/** Renova o token 60 s antes de vencer. */
const ANTECEDENCIA_RENOVAR_S = 60;

/** Quanto falta para renovar o token que vence em `exp` (segundos). */
function msParaRenovar(exp: number): number {
  return Math.max(5_000, (exp - ANTECEDENCIA_RENOVAR_S) * 1000 - Date.now());
}

interface Linha {
  quem: string;
  texto: string;
}

interface Props {
  assessmentId: string;
  /** A escuta gravou respostas: a conversa atualiza o rascunho e a versão. */
  aoRespostas: (respostas: Rascunho06, versao: string) => void;
  /** Pergunta a pergunta: envia a resposta falada à conversa. */
  enviarVoz: (texto: string) => Promise<boolean>;
  /** A conversa está esperando o assistente. */
  ocupado: boolean;
}

export function PainelEscuta({ assessmentId, aoRespostas, enviarVoz, ocupado }: Props) {
  const [estado, setEstado] = useState<EstadoEscutaTela | null>(null);
  const [disponivel, setDisponivel] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("fechado");
  const [modo, setModo] = useState<Modo>("pergunta");
  const [pessoas, setPessoas] = useState(1);
  const [concordo, setConcordo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [conectada, setConectada] = useState(false);
  const [canais, setCanais] = useState<CanalAudio[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [parcial, setParcial] = useState("");
  const [papeis, setPapeis] = useState<Papeis>({ chamada: false, vozConsultor: null });
  const [aguardandoSouEu, setAguardandoSouEu] = useState(false);
  const [respondendo, setRespondendo] = useState(false);
  const [resposta, setResposta] = useState("");
  // No servidor não há navegador (suportaEscuta devolve tudo falso); a tela só
  // aparece depois de ler o estado, já no navegador.
  const [suporte] = useState(suportaEscuta);

  const conexao = useRef<ConexaoEscuta | null>(null);
  const papeisRef = useRef(papeis);
  const souEuRef = useRef(false);
  const respondendoRef = useRef(false);
  const fila = useRef<{ seq: number; canal: "sala" | "remoto"; texto: string }[]>([]);
  const ultimoSeq = useRef(0);
  const enviando = useRef(false);
  const processando = useRef(false);
  const novos = useRef(0);
  const temporizador = useRef<number | null>(null);
  const renovacao = useRef<number | null>(null);
  const parando = useRef(false);

  // Os eventos da conexão leem o valor atual por ref (não renascem a cada render).
  useEffect(() => {
    papeisRef.current = papeis;
    souEuRef.current = aguardandoSouEu;
    respondendoRef.current = respondendo;
  }, [papeis, aguardandoSouEu, respondendo]);

  useEffect(() => {
    void (async () => {
      const r = await lerEscuta(assessmentId);
      if (!r.ok) return;
      setEstado(r.estado);
      setDisponivel(r.disponivel);
      if (r.estado.modo !== "desligada") setModo(r.estado.modo);
    })();
  }, [assessmentId]);

  // Sair da página fecha o microfone e a conexão.
  useEffect(
    () => () => {
      conexao.current?.fechar();
      if (temporizador.current) window.clearTimeout(temporizador.current);
      if (renovacao.current) window.clearTimeout(renovacao.current);
    },
    [],
  );

  // ------------------------------------------------ transcrição -> servidor

  const processar = useCallback(async () => {
    if (processando.current) return;
    processando.current = true;
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = null;
    novos.current = 0;
    try {
      // Uma chamada por vez; repete enquanto o servidor disser que há mais blocos.
      for (let i = 0; i < 5; i++) {
        const r = await processarEscuta(assessmentId);
        if (!r.ok) {
          setAviso(r.erro);
          break;
        }
        setEstado(r.estado);
        if (r.respostas && r.versao) aoRespostas(r.respostas, r.versao);
        if (!r.restantes) break;
      }
    } catch {
      setAviso("Sem conexão com o servidor; a transcrição é analisada quando voltar.");
    } finally {
      processando.current = false;
    }
  }, [assessmentId, aoRespostas]);

  const agendarProcessamento = useCallback(() => {
    if (novos.current >= BLOCOS_PARA_PROCESSAR) {
      void processar();
      return;
    }
    if (!temporizador.current) temporizador.current = window.setTimeout(() => void processar(), ESPERA_PROCESSAR_MS);
  }, [processar]);

  const enviarFila = useCallback(async () => {
    if (enviando.current || fila.current.length === 0) return;
    enviando.current = true;
    try {
      while (fila.current.length > 0) {
        const lote = fila.current.slice(0, 20);
        const r = await enviarBlocosEscuta(assessmentId, lote);
        if (!r.ok) {
          setAviso(r.erro);
          break;
        }
        fila.current = fila.current.slice(lote.length);
        novos.current += lote.length;
      }
    } catch {
      setAviso("Sem conexão com o servidor; a transcrição será enviada quando voltar.");
    } finally {
      enviando.current = false;
    }
    if (novos.current > 0) agendarProcessamento();
  }, [assessmentId, agendarProcessamento]);

  // ---------------------------------------------------------- conexão

  const quemFala = (canal: CanalAudio, falante?: number): string => {
    const p = papeisRef.current;
    if (canal === "aba") return "Cliente";
    if (p.chamada) return "Você";
    if (falante === undefined) return "Sala";
    if (p.vozConsultor === null) return `Voz ${falante + 1}`;
    return falante === p.vozConsultor ? "Você" : `Cliente (voz ${falante + 1})`;
  };

  const renovarDepois = (exp: number) => {
    if (renovacao.current) window.clearTimeout(renovacao.current);
    const ms = msParaRenovar(exp);
    renovacao.current = window.setTimeout(async () => {
      const t = await tokenEscuta(assessmentId).catch(() => null);
      if (!t || !t.ok) {
        setAviso(t && !t.ok ? t.erro : "Não foi possível renovar o áudio.");
        return;
      }
      setEstado((e) => (e ? { ...e, minutosRestantes: t.minutosRestantes } : e));
      conexao.current?.renovar(t.token);
      renovarDepois(t.exp);
    }, ms);
  };

  const conectar = async (m: Modo) => {
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
      aoParcial: (canal, texto, falante) => setParcial(`${quemFala(canal, falante)}: ${texto}`),
      aoFinal: (canal, texto, falante) => {
        setParcial("");
        if (souEuRef.current && canal === "microfone" && falante !== undefined) {
          setPapeis((p) => ({ ...p, vozConsultor: falante }));
          setAguardandoSouEu(false);
        }
        if (respondendoRef.current && canal === "microfone") setResposta((r) => (r ? `${r} ${texto}` : texto));
        setLinhas((l) => [...l.slice(-7), { quem: quemFala(canal, falante), texto }]);
      },
      aoBloco: (texto) => {
        if (m === "pergunta") return;
        const rotulado = rotularBloco(texto, papeisRef.current);
        ultimoSeq.current = proximoSeq(ultimoSeq.current, Date.now());
        fila.current.push({ seq: ultimoSeq.current, canal: canalDoBloco(texto), texto: rotulado });
        void enviarFila();
      },
      aoErro: (codigo) => {
        if (codigo === "stt_reconectando") return;
        if (codigo === "renovacao_recusada") setAviso("A renovação do áudio foi recusada; ele vai parar em instantes.");
        else if (codigo === "conexao") setAviso("Falha na conexão do áudio.");
      },
      aoFechar: (codigo) => {
        setConectada(false);
        setCanais([]);
        setRespondendo(false);
        if (renovacao.current) window.clearTimeout(renovacao.current);
        conexao.current = null;
        if (parando.current) return;
        setEtapa("fechado");
        setAviso(
          codigo === 4003
            ? "O áudio parou: o tempo reservado acabou. Conecte de novo se ainda houver minutos."
            : codigo === 4001
              ? "O áudio foi aberto em outra aba."
              : "A conexão do áudio caiu. Conecte de novo para continuar.",
        );
      },
    });
    conexao.current = c;
    renovarDepois(t.exp);
    try {
      await c.adicionarMicrofone();
      setCanais(c.canais());
      c.transmitir("microfone", m !== "pergunta");
      return true;
    } catch {
      c.fechar();
      conexao.current = null;
      setErro("O navegador não liberou o microfone. Permita o acesso ao microfone e tente de novo.");
      return false;
    }
  };

  const desconectar = async () => {
    const c = conexao.current;
    if (!c) return;
    parando.current = true;
    // Para de mandar áudio e espera o último trecho fechar (o Worker fecha após 6 s de silêncio).
    for (const canal of c.canais()) c.transmitir(canal, false);
    setTrabalhando(true);
    await new Promise((r) => window.setTimeout(r, 7_000));
    c.fechar();
    conexao.current = null;
    setConectada(false);
    setCanais([]);
    if (renovacao.current) window.clearTimeout(renovacao.current);
    await enviarFila();
    if (modo !== "pergunta") await processar();
    setTrabalhando(false);
  };

  // ---------------------------------------------------------- ações

  const registrarAviso = async () => {
    setTrabalhando(true);
    setErro(null);
    const r = await consentirEscuta(assessmentId, pessoas);
    setTrabalhando(false);
    if (!r.ok) return setErro(r.erro);
    setEstado(r.estado);
    setEtapa("modo");
  };

  const ligar = async () => {
    setTrabalhando(true);
    setErro(null);
    const r = await definirModoEscuta(assessmentId, modo);
    if (!r.ok) {
      setTrabalhando(false);
      return setErro(r.erro);
    }
    setEstado(r.estado);
    const ok = await conectar(modo);
    setTrabalhando(false);
    if (ok) setEtapa("ativo");
  };

  const desligar = async () => {
    await desconectar();
    const r = await definirModoEscuta(assessmentId, "desligada");
    if (r.ok) setEstado(r.estado);
    setEtapa("fechado");
    setLinhas([]);
    setPapeis({ chamada: false, vozConsultor: null });
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

  const comecarResposta = () => {
    setResposta("");
    setRespondendo(true);
    conexao.current?.transmitir("microfone", true);
  };

  const enviarResposta = async () => {
    conexao.current?.transmitir("microfone", false);
    setTrabalhando(true);
    // Espera a última fala virar texto final.
    await new Promise((r) => window.setTimeout(r, 1_500));
    setRespondendo(false);
    const texto = resposta.trim();
    if (!texto) {
      setTrabalhando(false);
      return setAviso("Nada foi ouvido. Tente de novo, mais perto do microfone.");
    }
    const ok = await enviarVoz(texto);
    setTrabalhando(false);
    if (ok) setResposta("");
  };

  const resolver = async (item: string, decisao: "confirmar" | "descartar") => {
    setTrabalhando(true);
    const r = await resolverEscuta(assessmentId, item, decisao);
    setTrabalhando(false);
    if (!r.ok) return setAviso(r.erro);
    setEstado(r.estado);
    if (r.respostas && r.versao) aoRespostas(r.respostas, r.versao);
  };

  // ---------------------------------------------------------- tela

  if (!estado || !disponivel || !suporte.microfone) {
    // Sem configuração ou sem suporte do navegador: o áudio simplesmente não aparece.
    return estado && estado.aConfirmar.length > 0 ? <ListaConfirmar estado={estado} resolver={resolver} ocupado={trabalhando} /> : null;
  }

  const ligadoNoBanco = estado.modo !== "desligada";

  return (
    <section className="escuta" aria-label="Assistente de áudio">
      {etapa === "fechado" && (
        <div className="escuta-linha">
          {ligadoNoBanco ? (
            <>
              <p className="field-hint">Áudio ligado ({ROTULO_MODO[estado.modo as Modo].nome}), mas o microfone não está conectado.</p>
              <button
                type="button"
                className="btn btn-inline btn-secondary"
                disabled={trabalhando}
                onClick={async () => {
                  setTrabalhando(true);
                  const m = estado.modo as Modo;
                  setModo(m);
                  if (await conectar(m)) setEtapa("ativo");
                  setTrabalhando(false);
                }}
              >
                Conectar microfone
              </button>
              <button type="button" className="btn btn-inline btn-secondary" disabled={trabalhando} onClick={() => void desligar()}>
                Desligar áudio
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-inline btn-secondary" onClick={() => setEtapa("aviso")}>
              Ativar assistente de áudio
            </button>
          )}
        </div>
      )}

      {etapa === "aviso" && (
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
              Continuar
            </button>
            <button type="button" className="btn btn-inline btn-secondary" onClick={() => setEtapa("fechado")}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {etapa === "modo" && (
        <div className="escuta-cartao">
          <h2 className="pergunta-titulo">Como usar o áudio</h2>
          <fieldset className="escuta-modos">
            <legend className="sr-only">Modo do áudio</legend>
            {(Object.keys(ROTULO_MODO) as Modo[]).map((m) => (
              <label key={m} className="escuta-check">
                <input type="radio" name="escuta-modo" value={m} checked={modo === m} onChange={() => setModo(m)} />
                <span>
                  <strong>{ROTULO_MODO[m].nome}.</strong> {ROTULO_MODO[m].descricao}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="escuta-linha">
            <button type="button" className="btn btn-inline" disabled={trabalhando} onClick={() => void ligar()}>
              {trabalhando ? "Ligando…" : "Ligar o áudio"}
            </button>
            <button type="button" className="btn btn-inline btn-secondary" onClick={() => setEtapa("fechado")}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {etapa === "ativo" && (
        <div className="escuta-cartao">
          <p className="escuta-status" role="status">
            {conectada ? "Áudio ligado" : "Conectando…"} · {ROTULO_MODO[modo].nome} · {estado.minutosRestantes} min restantes
          </p>

          {modo === "pergunta" ? (
            <div className="escuta-linha">
              {respondendo ? (
                <>
                  <button type="button" className="btn btn-inline" disabled={trabalhando} onClick={() => void enviarResposta()}>
                    Enviar resposta
                  </button>
                  <button
                    type="button"
                    className="btn btn-inline btn-secondary"
                    onClick={() => {
                      conexao.current?.transmitir("microfone", false);
                      setRespondendo(false);
                      setResposta("");
                    }}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-inline" disabled={!conectada || ocupado || trabalhando} onClick={comecarResposta}>
                  Responder falando
                </button>
              )}
            </div>
          ) : (
            <div className="escuta-linha">
              <label className="escuta-check">
                <input
                  type="checkbox"
                  checked={papeis.chamada}
                  onChange={(e) => setPapeis((p) => ({ ...p, chamada: e.target.checked }))}
                />
                Reunião por videochamada (meu microfone só capta a minha voz)
              </label>
              {suporte.aba && !canais.includes("aba") && (
                <button type="button" className="btn btn-inline btn-secondary" disabled={!conectada} onClick={() => void adicionarAba()}>
                  Adicionar áudio da chamada
                </button>
              )}
              {!papeis.chamada && (
                <button
                  type="button"
                  className="btn btn-inline btn-secondary"
                  disabled={!conectada || aguardandoSouEu}
                  onClick={() => setAguardandoSouEu(true)}
                >
                  {aguardandoSouEu ? "Fale algo agora…" : papeis.vozConsultor === null ? "Sou eu (marcar minha voz)" : `Sua voz: voz ${papeis.vozConsultor + 1} (marcar de novo)`}
                </button>
              )}
            </div>
          )}

          <div className="escuta-ao-vivo" aria-live="off">
            {linhas.map((l, i) => (
              <p key={i}>
                <span className="escuta-quem">{l.quem}:</span> {l.texto}
              </p>
            ))}
            {parcial && <p className="escuta-parcial">{parcial}</p>}
            {respondendo && <p className="escuta-resposta">Sua resposta: {resposta || "ouvindo…"}</p>}
          </div>

          <div className="escuta-linha">
            {modo !== "pergunta" && (
              <button type="button" className="btn btn-inline btn-secondary" disabled={trabalhando} onClick={() => void processar()}>
                Analisar agora
              </button>
            )}
            <button type="button" className="btn btn-inline btn-secondary" disabled={trabalhando} onClick={() => void desligar()}>
              {trabalhando ? "Finalizando…" : "Desligar áudio"}
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

      <ListaConfirmar estado={estado} resolver={resolver} ocupado={trabalhando} />
    </section>
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
  if (estado.aConfirmar.length === 0) return null;
  return (
    <div className="escuta-cartao">
      <h2 className="pergunta-titulo">Respostas ouvidas para confirmar</h2>
      <p className="field-hint">O assistente ouviu estas respostas com dúvida. Elas só entram no Self se você confirmar.</p>
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
