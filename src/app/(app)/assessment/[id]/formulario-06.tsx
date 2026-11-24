"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { AcaoState } from "@/lib/acao/tipos";
import { UFS } from "@/lib/assessment/questionario";
import { pendencias06, progresso06, somaDivisao, type Empresa06, type Questionario06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import { NAO_SEI, ROTULO_NAO_SEI, rotuloOpcao } from "@/lib/assessment/v06/tipos";
import { formatarCnpj } from "@/lib/validation/cnpj";
import { concluirSelf, salvarRascunho } from "../actions";
import { IndicadorProgresso06 } from "./progresso-06";

/**
 * Self 0.6 em formulário: as mesmas perguntas do roteiro curto, em etapas
 * (uma por vez, com a lista de etapas ao lado para pular entre elas).
 * É a alternativa à conversa (e a reserva se a conversa estiver fora do ar).
 * As perguntas de aprofundamento são opcionais: sem resposta, a linha entra
 * no relatório como hipótese.
 */

interface Props {
  assessmentId: string;
  questionario: Questionario06;
  inicial: Rascunho06;
  inicialEmpresa: Empresa06;
  versaoInicial: string;
  /** Perguntas de aprofundamento escolhidas pelo motor ao abrir (null: retrato incompleto). */
  aprofundamentoInicial: string[] | null;
}

type Salvamento = { estado: "ocioso" | "pendente" | "salvando" | "salvo" | "erro"; texto?: string };
const ESPERA_AUTOSAVE_MS = 1200;
const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" });
const reais = new Intl.NumberFormat("pt-BR");

function lerReais(texto: string): number | undefined {
  const d = texto.replace(/\D/g, "").slice(0, 13);
  return d === "" ? undefined : Number(d);
}

function lerPercentual(texto: string): number | undefined {
  const limpo = texto.replace(",", ".").replace(/[^\d.]/g, "");
  if (limpo === "") return undefined;
  const n = Number(limpo);
  return Number.isFinite(n) ? Math.min(100, Math.round(n * 10) / 10) : undefined;
}

export function Formulario06({ assessmentId, questionario: q, inicial, inicialEmpresa, versaoInicial, aprofundamentoInicial }: Props) {
  const [r, setR] = useState<Rascunho06>(inicial);
  const [emp, setEmp] = useState<Empresa06>(inicialEmpresa);
  const [usarFaixa, setUsarFaixa] = useState(inicial.receita_faixa !== undefined && inicial.receita_valor === undefined);
  const [salv, setSalv] = useState<Salvamento>({ estado: "ocioso" });
  const [aprofundamento, setAprofundamento] = useState<string[] | null>(aprofundamentoInicial);
  // Abre na primeira etapa com algo a responder (o progresso já diz onde a pessoa parou).
  const [etapa, setEtapa] = useState(() => {
    const p = progresso06(q, inicial, inicialEmpresa, aprofundamentoInicial);
    const aberto = p.proximo?.id;
    const i = aberto ? ETAPAS.findIndex((e) => !e.opcional && e.passos(aberto)) : ETAPAS.length - 1;
    return i < 0 ? 0 : i;
  });
  const titulo = useRef<HTMLHeadingElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const trocou = useRef(false);
  /** Troca de etapa: leva o foco ao título (leitor de tela e teclado) e o topo da etapa para a vista. */
  const irPara = (i: number) => {
    trocou.current = true;
    setEtapa(Math.max(0, Math.min(ETAPAS.length - 1, i)));
  };
  useEffect(() => {
    if (!trocou.current) return;
    titulo.current?.focus({ preventScroll: true });
    painel.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [etapa]);
  const ultimo = useRef<{ respostas: Rascunho06; empresa: Empresa06 }>({ respostas: inicial, empresa: inicialEmpresa });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versao = useRef(versaoInicial);
  // Salvamentos em fila: cada um parte da versão gravada pelo anterior.
  const fila = useRef<Promise<boolean>>(Promise.resolve(true));

  const salvar = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const executar = async () => {
      setSalv({ estado: "salvando" });
      const res = await salvarRascunho(assessmentId, ultimo.current, versao.current);
      if (res.ok) {
        if (res.salvoEm) versao.current = res.salvoEm;
        if (res.aprofundamento !== undefined) setAprofundamento(res.aprofundamento);
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

  const atualizar = (f: (atual: Rascunho06) => Rascunho06) => {
    setR((atual) => {
      const novo = f(atual);
      ultimo.current = { ...ultimo.current, respostas: novo };
      return novo;
    });
    agendar();
  };
  const set = <K extends keyof Rascunho06>(k: K, v: Rascunho06[K]) => atualizar((a) => ({ ...a, [k]: v }));
  /** Faixa e valor exato são excludentes: escolher um apaga o outro. */
  const setFaixa = (faixa: "folha" | "custo" | "margem", exata: "folha_exata" | "custo_exato" | "margem_exata", v: string) =>
    atualizar((a) => {
      const novo: Rascunho06 = { ...a, [faixa]: v };
      delete novo[exata];
      return novo;
    });

  const setEmpresa = (campo: keyof Empresa06, valor: string) => {
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

  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (salv.estado === "pendente" || salv.estado === "salvando") e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [salv.estado]);

  const [estadoConcluir, concluir, concluindo] = useActionState<AcaoState, FormData>(async (prev, form) => {
    if (timer.current) await salvar();
    return concluirSelf(prev, form);
  }, {});

  const faltas = pendencias06(r, emp);
  const marcadas = new Set(r.linhas_vermelhas ?? []);
  const soma = somaDivisao(r.divisao);

  // As perguntas que o motor escolheu sobem para o topo da seção e contam no progresso.
  const escolhidas = new Set(aprofundamento ?? []);
  const perguntas = [...q.perguntas].sort((a, b) => Number(escolhidas.has(b.id)) - Number(escolhidas.has(a.id)));

  const progresso = progresso06(q, r, emp, aprofundamento);
  const feitoPasso = new Map(progresso.passos.map((x) => [x.id, x.feito]));
  const estado = (e: Etapa): EstadoEtapa => {
    if (e.id === "concluir") return faltas.length === 0 ? "pronta" : "aberta";
    const ids = progresso.passos.map((x) => x.id).filter(e.passos);
    if (ids.length === 0) return e.opcional ? "opcional" : "aberta";
    const feitos = ids.filter((id) => feitoPasso.get(id)).length;
    if (feitos === ids.length) return "feita";
    if (e.opcional) return "opcional";
    return feitos > 0 ? "parcial" : "aberta";
  };
  const atual = ETAPAS[etapa];

  return (
    <div className="as-wizard">
      <aside className="as-lateral" aria-label="Etapas do assessment">
        <IndicadorProgresso06 p={progresso} compacto />
        <ol className="as-etapas">
          {ETAPAS.map((e, i) => {
            const st = estado(e);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={`as-etapa-botao as-etapa-${st}`}
                  aria-current={i === etapa ? "step" : undefined}
                  onClick={() => irPara(i)}
                >
                  <span className="as-etapa-marca" aria-hidden="true">
                    {st === "feita" || st === "pronta" ? <Visto /> : i + 1}
                  </span>
                  <span className="as-etapa-nome">
                    {e.nome}
                    <small>{ROTULO_ESTADO[st]}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className={salv.estado === "erro" ? "as-salvamento salvamento-erro" : "as-salvamento"} role="status" aria-live="polite">
          {salv.estado === "pendente" ? "Alterações não salvas" : salv.estado === "salvando" ? "Salvando…" : salv.texto ?? "Salvo automaticamente"}
        </p>
      </aside>

      <div className="as-etapa" ref={painel}>
        <p className="as-etapa-conta">
          Etapa {etapa + 1} de {ETAPAS.length}
          {atual.opcional ? " · opcional" : ""}
        </p>
        {atual.id === "empresa" && (
    <section className="as-etapa-corpo" aria-labelledby="f-empresa">
            <h2 id="f-empresa" ref={titulo} tabIndex={-1}>Empresa</h2>
            <div className="campos-lado">
              <Campo id="nome" rotulo="Nome da empresa" valor={emp.nome} aoMudar={(v) => setEmpresa("nome", v)} max={200} />
              <div className="field">
                <label htmlFor="cnpj">CNPJ</label>
                <input id="cnpj" inputMode="numeric" value={formatarCnpj(emp.cnpj ?? "")} onChange={(e) => setEmpresa("cnpj", e.target.value.replace(/\D/g, "").slice(0, 14))} />
              </div>
            </div>
            <div className="campos-lado">
              <Campo id="cidade" rotulo="Cidade" valor={emp.cidade} aoMudar={(v) => setEmpresa("cidade", v)} max={100} />
              <div className="field">
                <label htmlFor="uf">UF</label>
                <select id="uf" value={emp.uf ?? ""} onChange={(e) => setEmpresa("uf", e.target.value)}>
                  <option value="">Escolha</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="campos-lado">
              <Campo id="contato_nome" rotulo="Contato principal" valor={emp.contato_nome} aoMudar={(v) => setEmpresa("contato_nome", v)} max={120} />
              <Campo id="contato_cargo" rotulo="Cargo" valor={emp.contato_cargo} aoMudar={(v) => setEmpresa("contato_cargo", v)} max={120} />
            </div>
            <Campo id="contato_email" rotulo="E-mail do contato" valor={emp.contato_email} aoMudar={(v) => setEmpresa("contato_email", v)} max={254} />
          </section>
        )}
        {atual.id === "intocavel" && (
    <section className="as-etapa-corpo" aria-labelledby="f-intocavel">
            <h2 id="f-intocavel" ref={titulo} tabIndex={-1}>Antes de falar de ganho</h2>
            <fieldset className="pergunta">
              <legend className="pergunta-titulo">O que a IA nunca pode tocar no seu negócio?</legend>
              <p className="field-hint">Marque todas que se aplicam. Nada do que você marcar entra na conta.</p>
              <div className="opcoes">
                {q.linhasVermelhas.map((l) => (
                  <label key={l.id} className="opcao">
                    <input
                      type="checkbox"
                      checked={marcadas.has(l.id)}
                      onChange={(e) => {
                        const novo = new Set(marcadas);
                        if (e.target.checked) {
                          novo.add(l.id);
                          // "Nada específico" não convive com outras marcações.
                          if (l.id === "nenhuma") for (const x of [...novo]) if (x !== "nenhuma") novo.delete(x);
                          else novo.delete("nenhuma");
                        } else novo.delete(l.id);
                        set("linhas_vermelhas", q.linhasVermelhas.map((x) => x.id).filter((id) => novo.has(id)));
                      }}
                    />
                    <span>{l.nome}</span>
                  </label>
                ))}
                <label className="opcao">
                  <input
                    type="checkbox"
                    checked={marcadas.has(NAO_SEI)}
                    // Sem a informação, nada fica de fora da conta (igual a "Nada específico").
                    onChange={(e) => set("linhas_vermelhas", e.target.checked ? [NAO_SEI] : [])}
                  />
                  <span>{ROTULO_NAO_SEI}</span>
                </label>
              </div>
            </fieldset>
            <Campo id="lv-outro" rotulo="Outro (opcional)" valor={r.linhas_vermelhas_outro} aoMudar={(v) => set("linhas_vermelhas_outro", v)} max={200} />
          </section>
        )}
        {atual.id === "retrato" && (
    <section className="as-etapa-corpo" aria-labelledby="f-retrato">
            <h2 id="f-retrato" ref={titulo} tabIndex={-1}>Retrato econômico</h2>
            <p className="field-hint">Ordem de grandeza basta. &quot;{ROTULO_NAO_SEI}&quot; vale: vira um ponto medido no Deep.</p>
            <div className="pergunta">
              {usarFaixa ? (
                <Escolha nome="receita_faixa" legenda="Faturamento anual (faixa, R$)" opcoes={q.opcoes.receita} valor={r.receita_faixa} aoMudar={(v) => atualizar((a) => ({ ...a, receita_faixa: v, receita_valor: undefined }))} />
              ) : (
                <div className="field">
                  <label htmlFor="receita">Faturamento anual aproximado (R$)</label>
                  <input
                    id="receita"
                    inputMode="numeric"
                    value={r.receita_valor !== undefined ? reais.format(r.receita_valor) : ""}
                    onChange={(e) => atualizar((a) => ({ ...a, receita_valor: lerReais(e.target.value), receita_faixa: undefined }))}
                  />
                </div>
              )}
              <label className="check">
                <input type="checkbox" checked={usarFaixa} onChange={(e) => setUsarFaixa(e.target.checked)} />
                <span>Prefiro informar por faixa</span>
              </label>
            </div>
            <Escolha nome="pessoas" legenda="Quantas pessoas trabalham na empresa?" opcoes={q.opcoes.pessoas} valor={r.pessoas} aoMudar={(v) => set("pessoas", v)} />
            <fieldset className="pergunta">
              <legend className="pergunta-titulo">Como a receita se divide, mais ou menos? (%)</legend>
              <div className="campos-lado">
                {q.segmentos.map((s) => (
                  <div key={s.id} className="field">
                    <label htmlFor={`div-${s.id}`}>{s.nome}</label>
                    <input
                      id={`div-${s.id}`}
                      inputMode="decimal"
                      value={r.divisao?.[s.id] !== undefined ? String(r.divisao[s.id]).replace(".", ",") : ""}
                      onChange={(e) => {
                        const v = lerPercentual(e.target.value);
                        atualizar((a) => {
                          const d = { ...(a.divisao ?? {}) };
                          if (v === undefined) delete d[s.id];
                          else d[s.id] = v;
                          return { ...a, divisao: d };
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
              <p className={Math.abs(soma - 100) <= 0.5 ? "field-hint" : "field-error"}>Soma: {soma}% (precisa dar 100%)</p>
            </fieldset>
            <Escolha nome="folha" legenda="Quanto a folha, com encargos, pesa na receita?" opcoes={q.opcoes.folha} valor={r.folha} aoMudar={(v) => setFaixa("folha", "folha_exata", v)} />
            <Escolha nome="custo" legenda={q.custoPrincipal.pergunta} opcoes={q.opcoes.custo} valor={r.custo} aoMudar={(v) => setFaixa("custo", "custo_exato", v)} />
            <Escolha nome="contratacoes" legenda="Quantas pessoas vocês contratam por ano, comparado ao quadro?" opcoes={q.opcoes.contratacoes} valor={r.contratacoes} aoMudar={(v) => set("contratacoes", v)} />
            <Escolha nome="margem" legenda="Qual a margem líquida hoje?" opcoes={q.opcoes.margem} valor={r.margem} aoMudar={(v) => setFaixa("margem", "margem_exata", v)} />
            {(r.folha_exata !== undefined || r.custo_exato !== undefined || r.margem_exata !== undefined) && (
              <p className="field-hint">Valores exatos informados na conversa continuam valendo até você escolher uma faixa.</p>
            )}
          </section>
        )}
        {atual.id === "dor" && (
    <section className="as-etapa-corpo" aria-labelledby="f-dor">
            <h2 id="f-dor" ref={titulo} tabIndex={-1}>Onde dói</h2>
            <Escolha
              nome="dor"
              legenda="Se pudesse resolver um problema em 6 semanas, qual seria?"
              opcoes={q.dores.map((d) => d.id)}
              rotulo={(id) => q.dores.find((d) => d.id === id)?.nome ?? id}
              valor={r.dor}
              aoMudar={(v) => set("dor", v)}
            />
          </section>
        )}
        {atual.id === "precisao" && (
    <section className="as-etapa-corpo" aria-labelledby="f-nucleo">
            <h2 id="f-nucleo" ref={titulo} tabIndex={-1}>Para dar mais precisão (opcional)</h2>
            <p className="field-hint">
              Sem resposta, a linha correspondente entra no relatório como hipótese. As marcadas como recomendadas são as que mais mudam o seu
              número e contam no progresso.
            </p>
            {perguntas.map((p) => (
              <Escolha
                key={p.id}
                nome={`nucleo-${p.id}`}
                legenda={escolhidas.has(p.id) ? `${p.texto} (recomendada)` : p.texto}
                opcoes={p.opcoes}
                valor={r.nucleo?.[p.id]}
                aoMudar={(v) => atualizar((a) => ({ ...a, nucleo: { ...(a.nucleo ?? {}), [p.id]: v } }))}
              />
            ))}
          </section>
        )}
        {atual.id === "prontidao" && (
    <section className="as-etapa-corpo" aria-labelledby="f-prontidao">
            <h2 id="f-prontidao" ref={titulo} tabIndex={-1}>Prontidão</h2>
            <Escolha nome="uso_ia" legenda="Como a empresa usa IA hoje?" opcoes={q.opcoes.usoIa} valor={r.uso_ia} aoMudar={(v) => set("uso_ia", v)} />
            <Escolha nome="politica" legenda="Existe uma regra escrita sobre IA e dados?" opcoes={q.opcoes.politica} valor={r.politica} aoMudar={(v) => set("politica", v)} />
            <Escolha nome="patrocinio" legenda="Quem patrocina e se há orçamento?" opcoes={q.opcoes.patrocinio} valor={r.patrocinio} aoMudar={(v) => set("patrocinio", v)} />
          </section>
        )}
        {atual.id === "concluir" && (
    <section className="as-etapa-corpo" aria-labelledby="f-concluir">
            <h2 id="f-concluir" ref={titulo} tabIndex={-1}>Concluir</h2>
            {faltas.length > 0 ? (
              <ul className="pendencias">
                {faltas.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Tudo respondido. Confira e veja o resultado.</p>
            )}
            <form action={concluir}>
              <input type="hidden" name="assessmentId" value={assessmentId} />
              <button type="submit" className="btn btn-inline" disabled={concluindo || faltas.length > 0}>
                {concluindo ? "Calculando…" : "Ver resultado"}
              </button>
            </form>
            {estadoConcluir.message && (
              <p className="field-error" role="alert">
                {estadoConcluir.message}
              </p>
            )}
          </section>
        )}

        <div className="as-etapa-nav">
          {etapa > 0 && (
            <button type="button" className="btn btn-inline btn-secondary" onClick={() => irPara(etapa - 1)}>
              Voltar
            </button>
          )}
          {etapa < ETAPAS.length - 1 && (
            <button type="button" className="btn btn-inline" onClick={() => irPara(etapa + 1)}>
              {atual.opcional ? "Pular ou continuar" : "Continuar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type EstadoEtapa = "feita" | "parcial" | "aberta" | "opcional" | "pronta";
const ROTULO_ESTADO: Record<EstadoEtapa, string> = {
  feita: "Respondida",
  parcial: "Em andamento",
  aberta: "A responder",
  opcional: "Opcional",
  pronta: "Pronto para ver",
};

interface Etapa {
  id: "empresa" | "intocavel" | "retrato" | "dor" | "precisao" | "prontidao" | "concluir";
  nome: string;
  /** Quais passos do indicador de progresso pertencem à etapa. */
  passos: (idPasso: string) => boolean;
  opcional?: boolean;
}

/** As etapas seguem a ordem do roteiro 0.6 (a mesma da conversa). */
const ETAPAS: Etapa[] = [
  { id: "empresa", nome: "Empresa", passos: (x) => x === "empresa" },
  { id: "intocavel", nome: "O que a IA não toca", passos: (x) => x === "linhas_vermelhas" },
  {
    id: "retrato",
    nome: "Retrato econômico",
    passos: (x) => ["receita", "pessoas", "divisao", "folha", "custo", "contratacoes", "margem"].includes(x),
  },
  { id: "dor", nome: "Onde dói", passos: (x) => x === "dor" },
  { id: "precisao", nome: "Mais precisão", passos: (x) => x.startsWith("nucleo:"), opcional: true },
  { id: "prontidao", nome: "Prontidão", passos: (x) => ["uso_ia", "politica", "patrocinio"].includes(x) },
  { id: "concluir", nome: "Concluir", passos: () => false },
];

function Visto() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" focusable="false">
      <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function Campo({ id, rotulo, valor, aoMudar, max }: { id: string; rotulo: string; valor: string | undefined; aoMudar: (v: string) => void; max: number }) {
  return (
    <div className="field">
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} maxLength={max} value={valor ?? ""} onChange={(e) => aoMudar(e.target.value)} />
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
}

function Escolha({ nome, legenda, opcoes, valor, aoMudar, rotulo = rotuloOpcao }: EscolhaProps) {
  return (
    <fieldset className="pergunta">
      <legend className="pergunta-titulo">{legenda}</legend>
      <div className="opcoes">
        {opcoes.map((o) => (
          <label key={o} className="opcao">
            <input type="radio" name={nome} value={o} checked={valor === o} onChange={() => aoMudar(o)} />
            <span>{rotulo(o)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
