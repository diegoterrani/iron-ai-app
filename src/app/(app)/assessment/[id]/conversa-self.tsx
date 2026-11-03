"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { AcaoState } from "@/lib/acao/tipos";
import type { FalaTela } from "@/lib/assessment/agente/conversa";
import type { CampoSeguro } from "@/lib/assessment/agente/ferramentas";
import type { EmpresaSelf, Questionario, RespostasSelf } from "@/lib/assessment/questionario";
import { cnpjValido, formatarCnpj } from "@/lib/validation/cnpj";
import { concluirSelf, conversarSelf, lerConversa, salvarRascunho, type EntradaConversa } from "../actions";

/**
 * Self assessment em conversa: o agente guia do zero, uma pergunta por vez.
 * Tela cheia na própria página do assessment (não modal): voltar, recarregar
 * e abrir em outro aparelho retomam a mesma conversa, gravada no servidor.
 * As respostas ficam no mesmo rascunho do formulário.
 */

interface Props {
  assessmentId: string;
  questionario: Questionario;
  inicial: RespostasSelf;
  inicialEmpresa: EmpresaSelf;
  /** Limite de caracteres por mensagem (o servidor confere de novo). */
  maxTexto: number;
}

const ROTULO_SEGURO: Record<CampoSeguro, string> = { cnpj: "CNPJ da empresa", contato_telefone: "Telefone do contato" };

export function ConversaSelf({ assessmentId, questionario: q, inicial, inicialEmpresa, maxTexto }: Props) {
  const [falas, setFalas] = useState<FalaTela[]>([]);
  const [texto, setTexto] = useState("");
  const [aguardando, setAguardando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<RespostasSelf>(inicial);
  const [empresa, setEmpresa] = useState<EmpresaSelf>(inicialEmpresa);
  const [campoSeguro, setCampoSeguro] = useState<CampoSeguro | null>(null);
  const [mostrarResumo, setMostrarResumo] = useState(false);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const iniciou = useRef(false);

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
        setAguardando(false);
      } else {
        await enviar({ tipo: "inicio" });
      }
    })();
    // enviar é estável o bastante para a abertura; rodar uma vez só é o objetivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  // Rola até o fim da página a cada fala nova: a caixa de resposta é fixa no
  // rodapé, então rolar só até a última fala a deixaria escondida atrás dela.
  useEffect(() => {
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: suave ? "smooth" : "auto" }),
    );
  }, [falas, aguardando, campoSeguro, mostrarResumo, erro]);

  const aoEnviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const t = texto.trim();
    if (!t || aguardando) return;
    setTexto("");
    setMostrarResumo(false);
    const ok = await enviar({ tipo: "mensagem", texto: t }, { autor: "cliente", texto: t });
    if (!ok) setTexto(t);
  };

  const [estadoConcluir, concluir, concluindo] = useActionState<AcaoState, FormData>(concluirSelf, {});

  return (
    <section className="conversa" aria-label="Conversa do Self assessment">
      <div className="conversa-falas" role="log" aria-live="polite" aria-relevant="additions">
        {falas.map((f, i) => (
          <div key={i} className={f.autor === "agente" ? "fala fala-agente" : "fala fala-cliente"}>
            <span className="sr-only">{f.autor === "agente" ? "Assistente:" : "Você:"}</span>
            <TextoFala texto={f.texto} />
          </div>
        ))}
        {aguardando && (
          <p className="fala fala-agente fala-pensando" aria-label="O assistente está escrevendo">
            Escrevendo…
          </p>
        )}

        {campoSeguro && (
          <CampoSeguroCard
            campo={campoSeguro}
            aoSalvar={async (valor) => {
              const novaEmpresa = { ...empresa, [campoSeguro]: valor };
              const s = await salvarRascunho(assessmentId, { respostas, empresa: novaEmpresa });
              if (!s.ok) return s.erro ?? "Não foi possível salvar.";
              setEmpresa(novaEmpresa);
              const campo = campoSeguro;
              setCampoSeguro(null);
              await enviar({ tipo: "campo_preenchido", campo });
              return null;
            }}
          />
        )}

        {mostrarResumo && (
          <div className="resumo-conversa">
            <h2 className="pergunta-titulo">Confira o que foi registrado</h2>
            <Resumo q={q} r={respostas} e={empresa} />
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
        <p className="field-error" role="alert">
          {erro}
        </p>
      )}

      <form className="conversa-entrada" onSubmit={aoEnviar}>
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
      <p className="field-hint">
        Suas respostas são salvas a cada mensagem. CNPJ e telefone são digitados em campos próprios e não passam pelo
        assistente. <Link href={`/assessment/${assessmentId}?modo=formulario`}>Prefiro preencher em formulário</Link>
      </p>
    </section>
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
