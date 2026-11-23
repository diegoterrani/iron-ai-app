"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AcaoState } from "@/lib/acao/tipos";
import type { FalaTela } from "@/lib/assessment/agente/conversa";
import {
  INTERVALO_DIGITACAO_MS,
  PAUSA_ENTRE_BALOES_MS,
  palavrasPorPasso,
  pedacosDeDigitacao,
  textoParcial,
} from "@/lib/assessment/agente/digitacao";
import type { CampoSeguro } from "@/lib/assessment/agente/ferramentas";
import type { EmpresaSelf, Questionario, RespostasSelf } from "@/lib/assessment/questionario";
import { progresso06, type Questionario06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import { PainelEscuta } from "./painel-escuta";
import { IndicadorProgresso06 } from "./progresso-06";
import { Resumo06 } from "./resumo-06";
import { cnpjValido, formatarCnpj } from "@/lib/validation/cnpj";
import { concluirSelf, conversarSelf, lerConversa, salvarRascunho, type EntradaConversa } from "../actions";

/**
 * Self assessment em conversa: o agente guia do zero, uma pergunta por vez.
 * Tela cheia na própria página do assessment (não modal): voltar, recarregar
 * e abrir em outro aparelho retomam a mesma conversa, gravada no servidor.
 * As respostas ficam no mesmo rascunho do formulário.
 */

/** 0.6 (roteiro curto da skill do Self) ou 0.5 (rascunhos antigos): muda só o resumo. */
type Formato =
  | { formato: "0.5"; questionario: Questionario; inicial: RespostasSelf }
  | {
      formato: "0.6";
      questionario: Questionario06;
      inicial: Rascunho06;
      /** Perguntas de aprofundamento escolhidas pelo motor ao abrir (null: retrato incompleto). */
      aprofundamentoInicial: string[] | null;
    };

type Props = Formato & {
  assessmentId: string;
  inicialEmpresa: EmpresaSelf;
  /** Versão do rascunho ao abrir (atualizado_em); protege a edição de colegas da empresa. */
  versaoInicial: string;
  /** Limite de caracteres por mensagem (o servidor confere de novo). */
  maxTexto: number;
};

/** A pessoa está "no fim" da conversa se faltar menos que isto para o rodapé. */
const DISTANCIA_DO_FIM_PX = 120;
/** Janela em que eventos de rolagem são da própria tela (rolagem suave dura ~0,5 s). */
const IGNORAR_ROLAGEM_AUTO_MS = 700;

const ROTULO_SEGURO: Record<CampoSeguro, string> = { cnpj: "CNPJ da empresa", contato_telefone: "Telefone do contato" };

export function ConversaSelf(props: Props) {
  const { assessmentId, inicial, inicialEmpresa, versaoInicial, maxTexto } = props;
  const [falas, setFalas] = useState<FalaTela[]>([]);
  const [texto, setTexto] = useState("");
  const [aguardando, setAguardando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<RespostasSelf | Rascunho06>(inicial);
  const [empresa, setEmpresa] = useState<EmpresaSelf>(inicialEmpresa);
  const [campoSeguro, setCampoSeguro] = useState<CampoSeguro | null>(null);
  const [mostrarResumo, setMostrarResumo] = useState(false);
  const [aprofundamento, setAprofundamento] = useState<string[] | null>(props.formato === "0.6" ? props.aprofundamentoInicial : null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const iniciou = useRef(false);
  const versao = useRef(versaoInicial);

  // Digitação: falas com índice < `exibidas` aparecem inteiras; a fala de
  // índice `exibidas` está sendo revelada (`reveladas` pedaços); as seguintes
  // esperam a vez. O histórico gravado abre inteiro, sem animação.
  const [exibidas, setExibidas] = useState(0);
  const [reveladas, setReveladas] = useState(0);
  const digitando = exibidas < falas.length;
  const falaAtual = digitando ? falas[exibidas] : undefined;
  const pedacos = useMemo(() => (falaAtual ? pedacosDeDigitacao(falaAtual.texto) : []), [falaAtual]);

  useEffect(() => {
    if (!falaAtual) return;
    const semAnimacao = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const terminou = falaAtual.autor !== "agente" || semAnimacao || reveladas >= pedacos.length;
    // Fala pronta: passa para a próxima depois de uma pausa curta entre balões
    // (zero para fala do cliente ou movimento reduzido).
    const atraso = !terminou ? INTERVALO_DIGITACAO_MS : falaAtual.autor === "agente" && !semAnimacao ? PAUSA_ENTRE_BALOES_MS : 0;
    const passo = palavrasPorPasso(pedacos.length);
    const t = window.setTimeout(() => {
      if (terminou) {
        setExibidas((n) => n + 1);
        setReveladas(0);
      } else {
        setReveladas((n) => n + passo);
      }
    }, atraso);
    return () => window.clearTimeout(t);
  }, [falaAtual, pedacos, reveladas]);

  /** Mostra tudo de uma vez (quando o cliente responde antes do fim). */
  const pularDigitacao = () => {
    setExibidas(falas.length);
    setReveladas(0);
  };

  const enviar = async (e: EntradaConversa, fala?: FalaTela) => {
    setErro(null);
    setAguardando(true);
    if (fala) setFalas((f) => [...f, fala]);
    try {
      const r = await conversarSelf(assessmentId, e);
      if (!r.ok) {
        setErro(r.erro ?? "Não foi possível continuar.");
        return false;
      }
      setFalas((f) => [...f, ...(r.falas ?? [])]);
      if (r.respostas) setRespostas(r.respostas);
      if (r.empresa) setEmpresa(r.empresa);
      if (r.versao) versao.current = r.versao;
      if (r.aprofundamento !== undefined) setAprofundamento(r.aprofundamento);
      for (const s of r.sinais ?? []) {
        if (s.tipo === "campo_seguro") setCampoSeguro(s.campo);
        if (s.tipo === "resumo") setMostrarResumo(true);
      }
      return true;
    } catch {
      setErro("Sem conexão com o servidor. Confira a internet e tente de novo.");
      return false;
    } finally {
      setAguardando(false);
      requestAnimationFrame(() => entrada.current?.focus());
    }
  };

  // Abre a conversa gravada; vazia, o agente se apresenta.
  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    void (async () => {
      const r = await lerConversa(assessmentId);
      if (r.ok && r.falas && r.falas.length > 0) {
        setFalas(r.falas);
        setExibidas(r.falas.length);
        setAguardando(false);
      } else {
        await enviar({ tipo: "inicio" });
      }
    })();
    // enviar é estável o bastante para a abertura; rodar uma vez só é o objetivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  // Rolagem: acompanha o fim da página (a caixa de resposta é fixa no rodapé)
  // só enquanto a pessoa está lá. Se ela subiu para reler, a tela não a puxa
  // de volta; aparece "Ir para a última mensagem". Durante a digitação a
  // rolagem é imediata, para não brigar com uma animação suave a cada palavra.
  const noFim = useRef(true);
  const rolagemAutoEm = useRef(0);
  const [longeDoFim, setLongeDoFim] = useState(false);

  const rolarAteOFim = useCallback((suave: boolean) => {
    rolagemAutoEm.current = performance.now();
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: suave ? "smooth" : "auto" }),
    );
  }, []);

  useEffect(() => {
    const aoRolar = () => {
      // Ignora os eventos da própria rolagem automática (inclusive a suave).
      if (performance.now() - rolagemAutoEm.current < IGNORAR_ROLAGEM_AUTO_MS) return;
      const resto = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      const perto = resto < DISTANCIA_DO_FIM_PX;
      noFim.current = perto;
      setLongeDoFim(!perto);
    };
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  useEffect(() => {
    if (!noFim.current) return;
    const suave = !digitando && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rolarAteOFim(suave);
  }, [falas, exibidas, reveladas, digitando, aguardando, campoSeguro, mostrarResumo, erro, rolarAteOFim]);

  /** Volta ao fim e retoma o acompanhamento automático. */
  const irParaOFim = () => {
    noFim.current = true;
    setLongeDoFim(false);
    rolarAteOFim(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    entrada.current?.focus({ preventScroll: true });
  };

  const aoEnviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const t = texto.trim();
    if (!t || aguardando) return;
    pularDigitacao();
    setTexto("");
    setMostrarResumo(false);
    noFim.current = true;
    setLongeDoFim(false);
    const ok = await enviar({ tipo: "mensagem", texto: t }, { autor: "cliente", texto: t });
    if (!ok) setTexto(t);
  };

  const [estadoConcluir, concluir, concluindo] = useActionState<AcaoState, FormData>(concluirSelf, {});

  // Áudio: a escuta contínua grava respostas no rascunho; a conversa acompanha a versão.
  const aoRespostasDaEscuta = useCallback((r: Rascunho06, v: string) => {
    setRespostas(r);
    versao.current = v;
  }, []);
  // Áudio ligado: a tela se divide (perguntas à esquerda, captação à direita).
  const [audioAtivo, setAudioAtivo] = useState(false);
  const perguntaAtual = useMemo(() => {
    for (let i = falas.length - 1; i >= 0; i--) if (falas[i]?.autor === "agente") return falas[i]?.texto ?? null;
    return null;
  }, [falas]);
  // Entrevista guiada: a resposta revisada entra na conversa como fala do cliente.
  const enviarVoz = async (t: string) => {
    pularDigitacao();
    setMostrarResumo(false);
    noFim.current = true;
    setLongeDoFim(false);
    return enviar({ tipo: "voz", texto: t }, { autor: "cliente", texto: t });
  };

  return (
    <div className={audioAtivo ? "conversa-dividida" : "conversa-unica"}>
      <section className="conversa" aria-label="Conversa do Self assessment">
        {props.formato === "0.6" && (
          <IndicadorProgresso06 p={progresso06(props.questionario, respostas as Rascunho06, empresa, aprofundamento)} />
        )}
        <div className="conversa-falas" role="log" aria-live="polite" aria-relevant="additions">
          {falas.slice(0, exibidas + 1).map((f, i) => {
            const emDigitacao = i === exibidas;
            if (f.autor === "cliente") {
              return (
                <div key={i} className="fala fala-cliente">
                  <span className="sr-only">Você:</span>
                  <TextoFala texto={f.texto} />
                </div>
              );
            }
            // Leitor de tela recebe a fala inteira uma vez só; a parte que vai
            // aparecendo fica escondida dele para não ser anunciada a cada palavra.
            return (
              <div key={i} className={emDigitacao ? "fala fala-agente fala-digitando" : "fala fala-agente"}>
                <span className="sr-only">Assistente: {f.texto}</span>
                <span className="fala-autor" aria-hidden="true">
                  Assistente IRON AI
                </span>
                <div aria-hidden="true">
                  <TextoFala texto={emDigitacao ? textoParcial(pedacos, reveladas) : f.texto} />
                </div>
              </div>
            );
          })}
          {aguardando && (
            <p className="fala fala-agente fala-pensando" aria-label="O assistente está escrevendo">
              <span className="pontos" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Escrevendo
            </p>
          )}

          {campoSeguro && !digitando && (
            <CampoSeguroCard
              campo={campoSeguro}
              aoSalvar={async (valor) => {
                const novaEmpresa = { ...empresa, [campoSeguro]: valor };
                const s = await salvarRascunho(assessmentId, { respostas, empresa: novaEmpresa }, versao.current);
                if (!s.ok) return s.erro ?? "Não foi possível salvar.";
                if (s.salvoEm) versao.current = s.salvoEm;
                if (s.aprofundamento !== undefined) setAprofundamento(s.aprofundamento);
                setEmpresa(novaEmpresa);
                const campo = campoSeguro;
                setCampoSeguro(null);
                await enviar({ tipo: "campo_preenchido", campo });
                return null;
              }}
            />
          )}

          {mostrarResumo && !digitando && (
            <div className="resumo-conversa">
              <h2 className="pergunta-titulo">Confira o que foi registrado</h2>
              {props.formato === "0.6" ? (
                <Resumo06 q={props.questionario} r={respostas as Rascunho06} e={empresa} />
              ) : (
                <Resumo q={props.questionario} r={respostas as RespostasSelf} e={empresa} />
              )}
              <p className="field-hint">Se algo estiver errado, escreva abaixo o que corrigir. Se estiver tudo certo, confirme.</p>
              <form action={concluir}>
                <input type="hidden" name="assessmentId" value={assessmentId} />
                <button type="submit" className="btn btn-inline" disabled={concluindo}>
                  {concluindo ? "Calculando…" : "Confirmo, ver resultado"}
                </button>
              </form>
              {estadoConcluir.message && (
                <p className="field-error" role="alert">
                  {estadoConcluir.message}
                </p>
              )}
            </div>
          )}
        </div>

        {erro && (
          <div className="conversa-erro">
            <p className="field-error" role="alert">
              {erro}
            </p>
            {/* A abertura falhou (nenhuma fala ainda): sem isto a pessoa fica diante de uma caixa vazia. */}
            {falas.length === 0 && (
              <button type="button" className="btn btn-inline btn-secondary" disabled={aguardando} onClick={() => void enviar({ tipo: "inicio" })}>
                Tentar de novo
              </button>
            )}
          </div>
        )}

        <form className="conversa-entrada" onSubmit={aoEnviar}>
          {longeDoFim && (
            <button type="button" className="ir-para-fim" onClick={irParaOFim}>
              Ir para a última mensagem
            </button>
          )}
          <label htmlFor="mensagem" className="sr-only">
            Sua resposta
          </label>
          <textarea
            id="mensagem"
            ref={entrada}
            rows={2}
            maxLength={maxTexto}
            value={texto}
            placeholder="Escreva sua resposta"
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
        <p className="field-hint conversa-nota">
          Enter envia, Shift+Enter quebra a linha. Salvo a cada mensagem; CNPJ e telefone vão em campos próprios e não passam pelo assistente.
        </p>
      </section>
      {props.formato === "0.6" && (
        <PainelEscuta
          assessmentId={assessmentId}
          perguntaAtual={perguntaAtual}
          aoMudarAtivo={setAudioAtivo}
          enviarVoz={enviarVoz}
          aoRespostas={aoRespostasDaEscuta}
          ocupado={aguardando}
        />
      )}
    </div>
  );
}

/**
 * Texto de uma fala: linhas comuns viram parágrafos e linhas "1. Opção"
 * seguidas viram lista numerada (o cliente responde com o número).
 * Só texto puro: nada é interpretado como HTML.
 */
function TextoFala({ texto }: { texto: string }) {
  const blocos: ({ tipo: "p"; texto: string } | { tipo: "ol"; inicio: number; itens: string[] })[] = [];
  for (const linha of texto.split("\n")) {
    const item = /^\s*(\d{1,2})[.)]\s+(.+)$/.exec(linha);
    const ultimo = blocos[blocos.length - 1];
    if (item && ultimo?.tipo === "ol") ultimo.itens.push(item[2]);
    else if (item) blocos.push({ tipo: "ol", inicio: Number(item[1]), itens: [item[2]] });
    else if (linha.trim()) blocos.push({ tipo: "p", texto: linha });
  }
  return (
    <>
      {blocos.map((b, i) =>
        b.tipo === "p" ? (
          <p key={i}>{b.texto}</p>
        ) : (
          <ol key={i} start={b.inicio} className="fala-opcoes">
            {b.itens.map((t, j) => (
              <li key={j}>{t}</li>
            ))}
          </ol>
        ),
      )}
    </>
  );
}

function CampoSeguroCard({ campo, aoSalvar }: { campo: CampoSeguro; aoSalvar: (valor: string) => Promise<string | null> }) {
  const [valor, setValor] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const digitos = valor.replace(/\D/g, "");
  const valido = campo === "cnpj" ? cnpjValido(digitos) : digitos.length >= 10 && digitos.length <= 13;
  return (
    <form
      className="campo-seguro"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valido) {
          setMsg(campo === "cnpj" ? "CNPJ inválido. Confira os números." : "Telefone com DDD, só números.");
          return;
        }
        setSalvando(true);
        setMsg(await aoSalvar(digitos));
        setSalvando(false);
      }}
    >
      <div className="field">
        <label htmlFor={`seguro-${campo}`}>{ROTULO_SEGURO[campo]}</label>
        <input
          id={`seguro-${campo}`}
          inputMode="numeric"
          autoComplete={campo === "contato_telefone" ? "tel" : "off"}
          value={campo === "cnpj" ? formatarCnpj(digitos) : valor}
          onChange={(e) => setValor(e.target.value.replace(/\D/g, "").slice(0, campo === "cnpj" ? 14 : 13))}
        />
      </div>
      <p className="field-hint">Este campo vai direto para o cadastro. O assistente só fica sabendo que foi preenchido.</p>
      <button type="submit" className="btn btn-inline" disabled={salvando}>
        Salvar
      </button>
      {msg && (
        <p className="field-error" role="alert">
          {msg}
        </p>
      )}
    </form>
  );
}

/** Resumo legível do rascunho. Mostra o que foi registrado, sem números do resultado. */
function Resumo({ q, r, e }: { q: Questionario; r: RespostasSelf; e: EmpresaSelf }) {
  const nomeArea = (id: string) => q.areasQ5.find((a) => a.id === id)?.nome ?? id;
  const nomeFonte = (id: string) => q.dados.itens.find((i) => i.id === id)?.nome ?? id;
  const nomeSeg = (id: string) => q.segmentos.find((s) => s.id === id)?.nome ?? id;
  const lista = (v: string[] | undefined) => (v && v.length ? v.join(", ") : "—");
  const faturamento = r.q2_valor ? `R$ ${new Intl.NumberFormat("pt-BR").format(r.q2_valor)}` : r.q2 ? `faixa ${r.q2}` : "—";
  return (
    <dl className="resumo-lista">
      <dt>Empresa</dt>
      <dd>
        {e.nome ?? "—"}, {e.cidade ?? "—"}/{e.uf ?? "—"}. CNPJ {e.cnpj ? formatarCnpj(e.cnpj) : "—"}
      </dd>
      <dt>Contato principal</dt>
      <dd>
        {e.contato_nome ?? "—"} ({e.contato_cargo ?? "—"}), {e.contato_email ?? "—"}
      </dd>
      <dt>Porte</dt>
      <dd>
        Faturamento {faturamento}; {r.q3 ?? "—"} pessoas{r.q4 ? `; margem ${r.q4}` : ""}
      </dd>
      <dt>Operação</dt>
      <dd>
        {(r.unidades ?? []).map((u) => (
          <span key={u.segmento} className="resumo-item">
            {nomeSeg(u.segmento)}: {u.quantidade ?? "—"} unidades, {u.participacao_receita ?? "—"}% do faturamento
            {u.lugares_total !== undefined && `, ${u.lugares_total} lugares`}
            {u.ticket_pessoa && `, ticket R$ ${u.ticket_pessoa}`}
            {u.fila_pico && `, fila ${u.fila_pico}`}
            {u.refeicoes_dia !== undefined && `, ${u.refeicoes_dia} refeições por dia`}
          </span>
        ))}
      </dd>
      <dt>Como as áreas trabalham</dt>
      <dd>
        {q.areasQ5.map((a) => (
          <span key={a.id} className="resumo-item">
            {a.nome}: {lista(r.grade_q5?.[a.id])}
          </span>
        ))}
      </dd>
      <dt>Pessoas por área</dt>
      <dd>
        {Object.entries(r.pessoas_q6 ?? {}).map(([a, f]) => (
          <span key={a} className="resumo-item">
            {nomeArea(a)}: {f}
          </span>
        ))}
      </dd>
      <dt>Dados</dt>
      <dd>
        <span className="resumo-item">Onde ficam: {lista(r.q8)}</span>
        {Object.entries(r.dados_D ?? {}).map(([f, v]) => (
          <span key={f} className="resumo-item">
            {nomeFonte(f)}: {v}
          </span>
        ))}
      </dd>
      <dt>Prontidão</dt>
      <dd>
        <span className="resumo-item">Uso de IA: {lista(r.q9)}</span>
        <span className="resumo-item">Política de IA e dados: {r.q10 ?? "—"}</span>
        <span className="resumo-item">Patrocínio: {r.q11 ?? "—"}</span>
        <span className="resumo-item">Objetivos: {lista(r.q12)}</span>
      </dd>
    </dl>
  );
}
