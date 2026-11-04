"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { AcaoState } from "@/lib/acao/tipos";
import {
  PASSOS,
  Q7_MAX,
  UFS,
  ajustarPessoasQ6,
  alternarOpcao,
  areasQ6,
  pendencias,
  somaFecha,
  somaParticipacao,
  type EmpresaSelf,
  type Orientacao,
  type PassoId,
  type Questionario,
  type RespostasSelf,
  type UnidadeSelf,
} from "@/lib/assessment/questionario";
import { formatarCnpj } from "@/lib/validation/cnpj";
import { concluirSelf, salvarRascunho } from "../actions";

interface Props {
  assessmentId: string;
  questionario: Questionario;
  inicial: RespostasSelf;
  inicialEmpresa: EmpresaSelf;
  /** Versão do rascunho ao abrir (atualizado_em); protege a edição de colegas da empresa. */
  versaoInicial: string;
}

type Salvamento = { estado: "ocioso" | "pendente" | "salvando" | "salvo" | "erro"; texto?: string };

const ESPERA_AUTOSAVE_MS = 1200;
const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Só dígitos, sem separadores: "96.600.000" vira 96600000. Vazio vira null. */
function lerReais(texto: string): number | null {
  const d = texto.replace(/\D/g, "").slice(0, 13);
  return d === "" ? null : Number(d);
}

/** Percentual com até uma casa ("37,5" ou "37.5"), limitado a 100. Vazio vira undefined. */
function lerPercentual(texto: string): number | undefined {
  const limpo = texto.replace(",", ".").replace(/[^\d.]/g, "");
  if (limpo === "") return undefined;
  const n = Number(limpo);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(100, Math.round(n * 10) / 10);
}

function lerInteiro(texto: string): number | undefined {
  const d = texto.replace(/\D/g, "").slice(0, 7);
  return d === "" ? undefined : Number(d);
}

const reais = new Intl.NumberFormat("pt-BR");

export function QuestionarioSelf({ assessmentId, questionario: q, inicial, inicialEmpresa, versaoInicial }: Props) {
  const [r, setR] = useState<RespostasSelf>(inicial);
  const [emp, setEmp] = useState<EmpresaSelf>(inicialEmpresa);
  const [passo, setPasso] = useState(0);
  const [usarFaixa, setUsarFaixa] = useState(Boolean(inicial.q2) && !inicial.q2_valor);
  const [salv, setSalv] = useState<Salvamento>({ estado: "ocioso" });
  const ultimo = useRef<{ respostas: RespostasSelf; empresa: EmpresaSelf }>({ respostas: inicial, empresa: inicialEmpresa });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versao = useRef(versaoInicial);
  const titulo = useRef<HTMLHeadingElement>(null);

  // Salvamentos em fila: cada um parte da versão gravada pelo anterior. Dois
  // em paralelo usariam a mesma versão e o segundo seria recusado como conflito.
  const fila = useRef<Promise<boolean>>(Promise.resolve(true));

  const salvar = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const executar = async () => {
      const enviar = ultimo.current;
      setSalv({ estado: "salvando" });
      const res = await salvarRascunho(assessmentId, enviar, versao.current);
      if (res.ok) {
        if (res.salvoEm) versao.current = res.salvoEm;
        setSalv({ estado: "salvo", texto: res.salvoEm ? `Salvo às ${hora.format(new Date(res.salvoEm))}` : "Salvo" });
      } else {
        setSalv({ estado: "erro", texto: res.erro ?? "Não foi possível salvar." });
      }
      return res.ok;
    };
    const proximo = fila.current.then(executar, executar);
    fila.current = proximo;
    return proximo;
  }, [assessmentId]);

  const agendar = useCallback(() => {
    setSalv({ estado: "pendente" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void salvar(), ESPERA_AUTOSAVE_MS);
  }, [salvar]);

  /** Atualiza a resposta e agenda o salvamento automático. */
  const atualizar = useCallback(
    (f: (atual: RespostasSelf) => RespostasSelf) => {
      setR((atual) => {
        const novo = ajustarPessoasQ6(q, f(atual));
        ultimo.current = { ...ultimo.current, respostas: novo };
        return novo;
      });
      agendar();
    },
    [q, agendar],
  );

  const setEmpresa = (campo: keyof EmpresaSelf, valor: string) => {
    setEmp((atual) => {
      const novo = { ...atual, [campo]: valor };
      ultimo.current = { ...ultimo.current, empresa: novo };
      return novo;
    });
    agendar();
  };

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
  const unidades = r.unidades ?? [];
  /** Liga ou desliga um tipo de operação. Com um tipo só, ele fica com 100% do faturamento. */
  const marcarSegmento = (segmento: string, marcar: boolean) =>
    atualizar((a) => {
      let lista = (a.unidades ?? []).filter((u) => u.segmento !== segmento);
      if (marcar) {
        const ordem = q.segmentos.map((s) => s.id);
        lista = [...lista, { segmento }].sort((x, y) => ordem.indexOf(x.segmento) - ordem.indexOf(y.segmento));
      }
      if (lista.length === 1 && lista[0].participacao_receita === undefined) lista = [{ ...lista[0], participacao_receita: 100 }];
      return { ...a, unidades: lista };
    });
  const setUnidade = <K extends keyof UnidadeSelf>(segmento: string, campo: K, valor: UnidadeSelf[K]) =>
    atualizar((a) => ({
      ...a,
      unidades: (a.unidades ?? []).map((u) => (u.segmento === segmento ? { ...u, [campo]: valor } : u)),
    }));
  const setMapa = (campo: "pessoas_q6" | "dados_D", chave: string, valor: string) =>
    atualizar((a) => ({ ...a, [campo]: { ...a[campo], [chave]: valor } }));
  /** Marca ou desmarca um nível de uma área na pergunta 5 (escolha múltipla). */
  const marcarQ5 = (area: string, opcao: string, marcar: boolean) =>
    atualizar((a) => {
      const grade = { ...a.grade_q5, [area]: alternarOpcao(q.opcoes.nivelQ5, a.grade_q5?.[area], opcao, marcar) };
      if (grade[area].length === 0) delete grade[area];
      return { ...a, grade_q5: grade };
    });
  const marcar = (campo: "q8" | "q9" | "q12", opcoes: string[]) => (opcao: string, marcado: boolean) =>
    atualizar((a) => {
      const lista = alternarOpcao(opcoes, a[campo], opcao, marcado);
      return { ...a, [campo]: lista.length > 0 ? lista : undefined };
    });

  const idPasso: PassoId = PASSOS[passo].id;
  const faltas = pendencias(q, r, emp);
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

        {idPasso === "empresa" && (
          <>
            <p className="field-hint">
              Dados da empresa avaliada e de quem a IRON AI procura para falar do resultado. Ficam no seu assessment e
              não entram no cálculo.
            </p>
            <div className="campos-lado">
              <CampoTexto id="emp-nome" rotulo="Nome da empresa" valor={emp.nome} aoMudar={(v) => setEmpresa("nome", v)} max={200} autoComplete="organization" />
              <CampoTexto
                id="emp-cnpj"
                rotulo="CNPJ"
                valor={emp.cnpj ? formatarCnpj(emp.cnpj) : ""}
                aoMudar={(v) => setEmpresa("cnpj", v.replace(/\D/g, "").slice(0, 14))}
                max={18}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
              />
              <CampoTexto id="emp-cidade" rotulo="Cidade da sede" valor={emp.cidade} aoMudar={(v) => setEmpresa("cidade", v)} max={100} autoComplete="address-level2" />
              <div className="field">
                <label htmlFor="emp-uf">UF</label>
                <select id="emp-uf" value={emp.uf ?? ""} onChange={(e) => setEmpresa("uf", e.target.value)}>
                  <option value="" disabled>
                    Escolha…
                  </option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="pergunta-titulo">Contato principal</p>
            <div className="campos-lado">
              <CampoTexto id="emp-contato" rotulo="Nome" valor={emp.contato_nome} aoMudar={(v) => setEmpresa("contato_nome", v)} max={120} autoComplete="name" />
              <CampoTexto id="emp-cargo" rotulo="Cargo" valor={emp.contato_cargo} aoMudar={(v) => setEmpresa("contato_cargo", v)} max={120} autoComplete="organization-title" />
              <CampoTexto
                id="emp-email"
                rotulo="E-mail corporativo"
                valor={emp.contato_email}
                aoMudar={(v) => setEmpresa("contato_email", v)}
                max={254}
                type="email"
                autoComplete="email"
              />
              <CampoTexto
                id="emp-telefone"
                rotulo="Telefone (opcional)"
                valor={emp.contato_telefone}
                aoMudar={(v) => setEmpresa("contato_telefone", v.replace(/\D/g, "").slice(0, 13))}
                max={20}
                inputMode="tel"
                autoComplete="tel"
                placeholder="DDD + número"
              />
            </div>
          </>
        )}

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
            <fieldset className="pergunta">
              <legend className="pergunta-titulo">{q.unidades.U1.texto}</legend>
              <p className="field-hint">Marque todos os tipos que a empresa tem.</p>
              <div className="opcoes">
                {q.segmentos.map((s) => (
                  <label key={s.id} className="opcao">
                    <input
                      type="checkbox"
                      name="segmentos"
                      value={s.id}
                      checked={unidades.some((u) => u.segmento === s.id)}
                      onChange={(e) => marcarSegmento(s.id, e.target.checked)}
                    />
                    <span>
                      {s.nome} <span className="field-hint">({s.abrange})</span>
                    </span>
                  </label>
                ))}
              </div>
              <Ajuda orientacao={q.unidades.U1.orientacao} />
            </fieldset>

            {unidades.map((u) => {
              const seg = q.segmentos.find((s) => s.id === u.segmento);
              if (!seg) return null;
              const id = (campo: string) => `${seg.id}-${campo}`;
              return (
                <fieldset key={seg.id} className="pergunta">
                  <legend className="pergunta-titulo">{seg.nome}</legend>
                  <div className="campos-lado">
                    <div className="field">
                      <label htmlFor={id("quantidade")}>Quantas unidades</label>
                      <input
                        id={id("quantidade")}
                        inputMode="numeric"
                        value={u.quantidade ?? ""}
                        onChange={(e) => setUnidade(seg.id, "quantidade", lerInteiro(e.target.value))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={id("participacao")}>Parte do faturamento (%)</label>
                      <input
                        id={id("participacao")}
                        inputMode="decimal"
                        value={u.participacao_receita ?? ""}
                        onChange={(e) => setUnidade(seg.id, "participacao_receita", lerPercentual(e.target.value))}
                      />
                    </div>
                    {seg.campos.includes("lugares_total") && (
                      <div className="field">
                        <label htmlFor={id("lugares")}>Lugares no salão (soma)</label>
                        <input
                          id={id("lugares")}
                          inputMode="numeric"
                          value={u.lugares_total ?? ""}
                          onChange={(e) => setUnidade(seg.id, "lugares_total", lerInteiro(e.target.value))}
                        />
                      </div>
                    )}
                    {seg.campos.includes("refeicoes_dia") && (
                      <div className="field">
                        <label htmlFor={id("refeicoes")}>Refeições por dia (soma)</label>
                        <input
                          id={id("refeicoes")}
                          inputMode="numeric"
                          value={u.refeicoes_dia ?? ""}
                          onChange={(e) => setUnidade(seg.id, "refeicoes_dia", lerInteiro(e.target.value))}
                        />
                      </div>
                    )}
                  </div>
                  {seg.campos.includes("lugares_total") && <Ajuda orientacao={q.setoriais.S1.orientacao} />}
                  {seg.campos.includes("refeicoes_dia") && <Ajuda orientacao={q.unidades.I1.orientacao} />}
                  {seg.campos.includes("ticket_pessoa") && (
                    <Escolha
                      nome={id("ticket")}
                      legenda={q.setoriais.S2.texto}
                      opcoes={q.opcoes.ticket}
                      rotulo={(o) => `R$ ${o}`}
                      valor={u.ticket_pessoa}
                      aoMudar={(v) => setUnidade(seg.id, "ticket_pessoa", v)}
                      ajuda={q.setoriais.S2.orientacao}
                    />
                  )}
                  {seg.campos.includes("fila_pico") && (
                    <Escolha
                      nome={id("fila")}
                      legenda={q.setoriais.S3.texto}
                      opcoes={q.opcoes.fila}
                      valor={u.fila_pico}
                      aoMudar={(v) => setUnidade(seg.id, "fila_pico", v)}
                      ajuda={q.setoriais.S3.orientacao}
                    />
                  )}
                </fieldset>
              );
            })}

            {unidades.length > 1 && (
              <p className={somaFecha(unidades) ? "field-hint" : "field-error"} role="status">
                Soma da parte do faturamento: {somaParticipacao(unidades).toLocaleString("pt-BR")}% (precisa dar 100%).
              </p>
            )}
          </>
        )}

        {idPasso === "esforco" && (
          <>
            <p className="pergunta-titulo">Como cada área faz o trabalho do dia a dia hoje?</p>
            <p className="field-hint">
              Marque todas as formas que a área usa (por exemplo, planilhas e sistema). As áreas que mais pesam no setor vêm
              primeiro.
            </p>
            <div className="grade">
              {q.areasQ5.map((a) => (
                <EscolhaMultipla
                  key={a.id}
                  nome={`q5-${a.id}`}
                  legenda={a.nome}
                  opcoes={q.opcoes.nivelQ5}
                  valor={r.grade_q5?.[a.id]}
                  aoMudar={(o, m) => marcarQ5(a.id, o, m)}
                  compacta
                />
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
            <EscolhaMultipla
              nome="q8"
              legenda="Onde ficam os dados do dia a dia?"
              opcoes={q.opcoes.q8}
              valor={r.q8}
              aoMudar={marcar("q8", q.opcoes.q8)}
            />
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
            <EscolhaMultipla
              nome="q9"
              legenda="Como a empresa usa IA hoje?"
              opcoes={q.opcoes.q9}
              valor={r.q9}
              aoMudar={marcar("q9", q.opcoes.q9)}
            />
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
            <EscolhaMultipla
              nome="q12"
              legenda="Quais são os objetivos principais?"
              opcoes={q.opcoes.q12}
              valor={r.q12}
              aoMudar={marcar("q12", q.opcoes.q12)}
            />
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

interface EscolhaMultiplaProps {
  nome: string;
  legenda: string;
  opcoes: string[];
  valor: string[] | undefined;
  aoMudar: (opcao: string, marcada: boolean) => void;
  /** Versão em coluna, para a grade de áreas. */
  compacta?: boolean;
}

/** Pergunta de escolha múltipla: fieldset + caixas de seleção. */
function EscolhaMultipla({ nome, legenda, opcoes, valor, aoMudar, compacta }: EscolhaMultiplaProps) {
  const marcadas = new Set(valor ?? []);
  return (
    <fieldset className="pergunta">
      <legend className={compacta ? "pergunta-area" : "pergunta-titulo"}>{legenda}</legend>
      {!compacta && <p className="field-hint">Marque todas que se aplicam.</p>}
      <div className={compacta ? "opcoes opcoes-coluna" : "opcoes"}>
        {opcoes.map((o) => (
          <label key={o} className="opcao">
            <input type="checkbox" name={nome} value={o} checked={marcadas.has(o)} onChange={(e) => aoMudar(o, e.target.checked)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
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

interface CampoTextoProps {
  id: string;
  rotulo: string;
  valor: string | undefined;
  aoMudar: (v: string) => void;
  max: number;
  type?: string;
  inputMode?: "numeric" | "tel" | "email" | "text";
  autoComplete?: string;
  placeholder?: string;
}

function CampoTexto({ id, rotulo, valor, aoMudar, max, type = "text", inputMode, autoComplete, placeholder }: CampoTextoProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={max}
        value={valor ?? ""}
        onChange={(e) => aoMudar(e.target.value)}
      />
    </div>
  );
}
