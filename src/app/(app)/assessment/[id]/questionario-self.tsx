"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { AcaoState } from "@/lib/acao/tipos";
import {
  PASSOS,
  Q7_MAX,
  ajustarPessoasQ6,
  areasQ6,
  pendencias,
  type Orientacao,
  type PassoId,
  type Questionario,
  type RespostasSelf,
} from "@/lib/assessment/questionario";
import { concluirSelf, salvarRespostas } from "../actions";

interface Props {
  assessmentId: string;
  questionario: Questionario;
  inicial: RespostasSelf;
}

type Salvamento = { estado: "ocioso" | "pendente" | "salvando" | "salvo" | "erro"; texto?: string };

const ESPERA_AUTOSAVE_MS = 1200;
const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Só dígitos, sem separadores: "96.600.000" vira 96600000. Vazio vira null. */
function lerReais(texto: string): number | null {
  const d = texto.replace(/\D/g, "").slice(0, 13);
  return d === "" ? null : Number(d);
}

function lerInteiro(texto: string): number | undefined {
  const d = texto.replace(/\D/g, "").slice(0, 7);
  return d === "" ? undefined : Number(d);
}

const reais = new Intl.NumberFormat("pt-BR");

export function QuestionarioSelf({ assessmentId, questionario: q, inicial }: Props) {
  const [r, setR] = useState<RespostasSelf>(inicial);
  const [passo, setPasso] = useState(0);
  const [usarFaixa, setUsarFaixa] = useState(Boolean(inicial.q2) && !inicial.q2_valor);
  const [salv, setSalv] = useState<Salvamento>({ estado: "ocioso" });
  const ultimo = useRef<RespostasSelf>(inicial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);

  const salvar = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const enviar = ultimo.current;
    setSalv({ estado: "salvando" });
    const res = await salvarRespostas(assessmentId, enviar);
    if (res.ok) {
      setSalv({ estado: "salvo", texto: res.salvoEm ? `Salvo às ${hora.format(new Date(res.salvoEm))}` : "Salvo" });
    } else {
      setSalv({ estado: "erro", texto: res.erro ?? "Não foi possível salvar." });
    }
    return res.ok;
  }, [assessmentId]);

  /** Atualiza a resposta e agenda o salvamento automático. */
  const atualizar = useCallback(
    (f: (atual: RespostasSelf) => RespostasSelf) => {
      setR((atual) => {
        const novo = ajustarPessoasQ6(q, f(atual));
        ultimo.current = novo;
        return novo;
      });
      setSalv({ estado: "pendente" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void salvar(), ESPERA_AUTOSAVE_MS);
    },
    [q, salvar],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Aviso ao fechar a aba com alteração ainda não salva.
  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (salv.estado === "pendente" || salv.estado === "salvando") e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [salv.estado]);

  const irPara = async (i: number) => {
    if (timer.current) await salvar();
    setPasso(i);
    // Leva o foco ao título do passo (leitores de tela anunciam a mudança).
    requestAnimationFrame(() => titulo.current?.focus());
  };

  const [estadoConcluir, concluir, concluindo] = useActionState<AcaoState, FormData>(async (prev, form) => {
    if (salv.estado !== "salvo" && salv.estado !== "ocioso") {
      const ok = await salvar();
      if (!ok) return { message: "Salve as respostas antes de concluir." };
    }
    return concluirSelf(prev, form);
  }, {});

  const set = <K extends keyof RespostasSelf>(campo: K, valor: RespostasSelf[K]) => atualizar((a) => ({ ...a, [campo]: valor }));
  const setSetorial = (campo: keyof NonNullable<RespostasSelf["setoriais"]>, valor: string | number | undefined) =>
    atualizar((a) => ({ ...a, setoriais: { ...a.setoriais, [campo]: valor } }));
  const setMapa = (campo: "grade_q5" | "pessoas_q6" | "dados_D", chave: string, valor: string) =>
    atualizar((a) => ({ ...a, [campo]: { ...a[campo], [chave]: valor } }));

  const idPasso: PassoId = PASSOS[passo].id;
  const faltas = pendencias(q, r);
  const ultimoPasso = passo === PASSOS.length - 1;
  const nomeArea = (id: string) => q.areasQ5.find((a) => a.id === id)?.nome ?? id;
  const areas6 = areasQ6(q, r.grade_q5);

  return (
    <div className="questionario">
      <nav aria-label="Etapas do questionário">
        <ol className="passos">
          {PASSOS.map((p, i) => {
            const pendente = faltas.some((f) => f.passo === p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="passo"
                  aria-current={i === passo ? "step" : undefined}
                  onClick={() => void irPara(i)}
                >
                  <span className="passo-num">{i + 1}</span> {p.titulo}
                  {!pendente && <span className="sr-only"> (completo)</span>}
                  {!pendente && <span aria-hidden="true"> ✓</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <p className={`salvamento salvamento-${salv.estado}`} role="status" aria-live="polite">
        {salv.estado === "pendente" && "Alterações ainda não salvas…"}
        {salv.estado === "salvando" && "Salvando…"}
        {(salv.estado === "salvo" || salv.estado === "erro") && salv.texto}
      </p>

      <section className="passo-conteudo" aria-labelledby="titulo-passo">
        <h2 id="titulo-passo" ref={titulo} tabIndex={-1}>
          {passo + 1}. {PASSOS[passo].titulo}
        </h2>

        {idPasso === "perfil" && (
          <>
            <div className="pergunta">
              <label htmlFor="q2_valor" className="pergunta-titulo">
                Qual o faturamento anual aproximado da empresa?
              </label>
              {!usarFaixa ? (
                <div className="field">
                  <input
                    id="q2_valor"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Ex.: 96.600.000"
                    value={r.q2_valor ? reais.format(r.q2_valor) : ""}
                    onChange={(e) => set("q2_valor", lerReais(e.target.value))}
                    aria-describedby="q2-dica"
                  />
                  <p id="q2-dica" className="field-hint">
                    Em reais, valor do último ano. Um número aproximado deixa o cálculo bem mais preciso que a faixa.
                  </p>
                </div>
              ) : (
                <Escolha
                  nome="q2"
                  legenda="Faixa de faturamento anual (R$)"
                  opcoes={q.opcoes.receita}
                  valor={r.q2}
                  aoMudar={(v) => set("q2", v)}
                  oculta
                />
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={usarFaixa}
                  onChange={(e) => {
                    setUsarFaixa(e.target.checked);
                    atualizar((a) => (e.target.checked ? { ...a, q2_valor: null } : { ...a, q2: undefined }));
                  }}
                />
                Prefiro informar uma faixa (o resultado fica menos preciso)
              </label>
            </div>
            <Escolha nome="q3" legenda="Quantas pessoas trabalham na empresa?" opcoes={q.opcoes.pessoasTotal} valor={r.q3} aoMudar={(v) => set("q3", v)} />
            <Escolha
              nome="q4"
              legenda="Margem líquida aproximada (opcional)"
              opcoes={q.opcoes.margem}
              valor={r.q4}
              aoMudar={(v) => set("q4", v)}
            />
          </>
        )}

        {idPasso === "setor" && (
          <>
            <div className="pergunta">
              <p className="pergunta-titulo">{q.setoriais.S1.texto}</p>
              <div className="campos-lado">
                <div className="field">
                  <label htmlFor="unidades">Unidades</label>
                  <input
                    id="unidades"
                    inputMode="numeric"
                    value={r.setoriais?.unidades ?? ""}
                    onChange={(e) => setSetorial("unidades", lerInteiro(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="lugares_total">Lugares no salão (soma)</label>
                  <input
                    id="lugares_total"
                    inputMode="numeric"
                    value={r.setoriais?.lugares_total ?? ""}
                    onChange={(e) => setSetorial("lugares_total", lerInteiro(e.target.value))}
                  />
                </div>
              </div>
              <Ajuda orientacao={q.setoriais.S1.orientacao} />
            </div>
            <Escolha
              nome="ticket_pessoa"
              legenda={q.setoriais.S2.texto}
              opcoes={q.opcoes.ticket}
              rotulo={(o) => `R$ ${o}`}
              valor={r.setoriais?.ticket_pessoa}
              aoMudar={(v) => setSetorial("ticket_pessoa", v)}
              ajuda={q.setoriais.S2.orientacao}
            />
            <Escolha
              nome="fila_pico"
              legenda={q.setoriais.S3.texto}
              opcoes={q.opcoes.fila}
              valor={r.setoriais?.fila_pico}
              aoMudar={(v) => setSetorial("fila_pico", v)}
              ajuda={q.setoriais.S3.orientacao}
            />
          </>
        )}

        {idPasso === "esforco" && (
          <>
            <p className="pergunta-titulo">Como cada área faz o trabalho do dia a dia hoje?</p>
            <p className="field-hint">As áreas que mais pesam no setor vêm primeiro.</p>
            <div className="grade">
              {q.areasQ5.map((a) => (
                <div className="field" key={a.id}>
                  <label htmlFor={`q5-${a.id}`}>{a.nome}</label>
                  <select id={`q5-${a.id}`} value={r.grade_q5?.[a.id] ?? ""} onChange={(e) => setMapa("grade_q5", a.id, e.target.value)}>
                    <option value="" disabled>
                      Escolha…
                    </option>
                    {q.opcoes.nivelQ5.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        {idPasso === "pessoas" && (
          <>
            {areas6.length === 0 ? (
              <p className="notice" role="note">
                Responda primeiro como cada área trabalha (etapa 3). As áreas desta pergunta dependem dessa resposta.
              </p>
            ) : (
              <>
                <p className="pergunta-titulo">Quantas pessoas, aproximadamente, trabalham em cada uma destas áreas?</p>
                <p className="field-hint">
                  São as áreas com maior potencial para a sua empresa. Conte quem dedica a maior parte do dia à área; meio
                  período conta como meio.
                </p>
                <div className="grade">
                  {areas6.map((a) => (
                    <div className="field" key={a}>
                      <label htmlFor={`q6-${a}`}>{nomeArea(a)}</label>
                      <select id={`q6-${a}`} value={r.pessoas_q6?.[a] ?? ""} onChange={(e) => setMapa("pessoas_q6", a, e.target.value)}>
                        <option value="" disabled>
                          Escolha…
                        </option>
                        {q.opcoes.pessoasArea.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="field pergunta">
              <label htmlFor="q7" className="pergunta-titulo">
                Descreva uma tarefa que mais consome tempo dessas equipes (opcional)
              </label>
              <textarea
                id="q7"
                rows={3}
                maxLength={Q7_MAX}
                value={r.q7 ?? ""}
                onChange={(e) => set("q7", e.target.value)}
                aria-describedby="q7-dica"
              />
              <p id="q7-dica" className="field-hint">
                Sem nomes de pessoas ou dados de clientes. {(r.q7 ?? "").length}/{Q7_MAX}
              </p>
            </div>
          </>
        )}

        {idPasso === "dados" && (
          <>
            <Escolha nome="q8" legenda="Onde ficam os dados do dia a dia?" opcoes={q.opcoes.q8} valor={r.q8} aoMudar={(v) => set("q8", v)} />
            <p className="pergunta-titulo">{q.dados.texto}</p>
            <p className="field-hint">Marque só o que é registrado de forma regular. Se não souber, escolha “não sei”.</p>
            <div className="grade">
              {q.dados.itens.map((i) => (
                <div className="field" key={i.id}>
                  <label htmlFor={`d-${i.id}`}>{i.nome}</label>
                  <select id={`d-${i.id}`} value={r.dados_D?.[i.id] ?? ""} onChange={(e) => setMapa("dados_D", i.id, e.target.value)}>
                    <option value="" disabled>
                      Escolha…
                    </option>
                    {q.opcoes.cobertura.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        {idPasso === "prontidao" && (
          <>
            <Escolha nome="q9" legenda="Como a empresa usa IA hoje?" opcoes={q.opcoes.q9} valor={r.q9} aoMudar={(v) => set("q9", v)} />
            <Escolha
              nome="q10"
              legenda="Existe política de uso de IA e de proteção de dados?"
              opcoes={q.opcoes.q10}
              valor={r.q10}
              aoMudar={(v) => set("q10", v)}
            />
            <Escolha
              nome="q11"
              legenda="Quem patrocinaria um projeto de IA, e há orçamento previsto?"
              opcoes={q.opcoes.q11}
              valor={r.q11}
              aoMudar={(v) => set("q11", v)}
            />
            <Escolha nome="q12" legenda="Qual o principal objetivo?" opcoes={q.opcoes.q12} valor={r.q12} aoMudar={(v) => set("q12", v)} />
          </>
        )}
      </section>

      <div className="navegacao">
        {passo > 0 && (
          <button type="button" className="btn btn-inline btn-secondary" onClick={() => void irPara(passo - 1)}>
            Voltar
          </button>
        )}
        {!ultimoPasso && (
          <button type="button" className="btn btn-inline" onClick={() => void irPara(passo + 1)}>
            Próximo
          </button>
        )}
      </div>

      {ultimoPasso && (
        <section className="secao" aria-labelledby="sec-concluir">
          <h2 id="sec-concluir">Concluir</h2>
          {faltas.length > 0 ? (
            <>
              <p>Faltam algumas respostas para calcular:</p>
              <ul className="pendencias">
                {faltas.map((f) => (
                  <li key={f.texto}>
                    <button type="button" className="link-botao" onClick={() => void irPara(PASSOS.findIndex((p) => p.id === f.passo))}>
                      {f.texto}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Tudo respondido. Depois de concluir, as respostas não podem ser alteradas.</p>
          )}
          <form action={concluir} className="acao-form">
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <button type="submit" className="btn btn-inline" disabled={concluindo || faltas.length > 0}>
              {concluindo ? "Calculando…" : "Concluir e ver resultado"}
            </button>
            {estadoConcluir.message && (
              <p className="acao-msg acao-msg-erro" role="alert">
                {estadoConcluir.message}
              </p>
            )}
          </form>
        </section>
      )}
    </div>
  );
}

interface EscolhaProps {
  nome: string;
  legenda: string;
  opcoes: string[];
  valor: string | undefined;
  aoMudar: (v: string) => void;
  rotulo?: (o: string) => string;
  ajuda?: Orientacao;
  /** Legenda só para leitor de tela (quando já há título visível). */
  oculta?: boolean;
}

/** Pergunta de escolha única: fieldset + radios (navegável por teclado, anunciado por leitores de tela). */
function Escolha({ nome, legenda, opcoes, valor, aoMudar, rotulo = (o) => o, ajuda, oculta }: EscolhaProps) {
  return (
    <fieldset className="pergunta">
      <legend className={oculta ? "sr-only" : "pergunta-titulo"}>{legenda}</legend>
      <div className="opcoes">
        {opcoes.map((o) => (
          <label key={o} className="opcao">
            <input type="radio" name={nome} value={o} checked={valor === o} onChange={() => aoMudar(o)} />
            <span>{rotulo(o)}</span>
          </label>
        ))}
      </div>
      {ajuda && <Ajuda orientacao={ajuda} />}
    </fieldset>
  );
}

/** Orientação do pacote do setor, recolhida por padrão. */
function Ajuda({ orientacao: o }: { orientacao: Orientacao }) {
  if (!o.por_que && !o.como_responder && !o.exemplo && !o.se_nao_souber) return null;
  return (
    <details className="ajuda">
      <summary>Como responder</summary>
      <dl>
        {o.por_que && (
          <>
            <dt>Por que perguntamos</dt>
            <dd>{o.por_que}</dd>
          </>
        )}
        {o.como_responder && (
          <>
            <dt>Como responder</dt>
            <dd>{o.como_responder}</dd>
          </>
        )}
        {o.exemplo && (
          <>
            <dt>Exemplo</dt>
            <dd>{o.exemplo}</dd>
          </>
        )}
        {o.se_nao_souber && (
          <>
            <dt>Se não souber</dt>
            <dd>{o.se_nao_souber}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
