"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buscarEmpresas, vincularEmpresa, type EmpresaEncontrada } from "../empresas-actions";

/**
 * Começo do assessment pessoal: escolher uma empresa já cadastrada (com
 * busca) ou cadastrar uma nova. Escolher copia os dados para o rascunho e
 * recarrega a página (a conversa e o formulário remontam com a empresa).
 * Uma empresa nova entra no cadastro quando o assessment é concluído.
 */

interface Props {
  assessmentId: string;
  /** Empresa do cadastro já vinculada a este rascunho. */
  vinculada: { nome: string; local: string | null } | null;
  /** Abre a busca de início (rascunho sem empresa). */
  abrir: boolean;
  /** Conversa ou formulário: aparece depois da escolha. */
  children: ReactNode;
}

const ESPERA_BUSCA_MS = 300;

function formatarCnpj(c: string): string {
  return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
}

export function EscolhaEmpresa({ assessmentId, vinculada, abrir, children }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(abrir);
  const [termo, setTermo] = useState("");
  const [empresas, setEmpresas] = useState<EmpresaEncontrada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const espera = useRef<number | null>(null);
  const ultimaBusca = useRef(0);

  const buscar = async (t: string) => {
    const n = ++ultimaBusca.current;
    const r = await buscarEmpresas(t);
    if (n !== ultimaBusca.current) return; // resposta de uma busca antiga
    if (r.ok) {
      setEmpresas(r.empresas);
      setErro(null);
    } else setErro(r.erro);
  };

  // Ao abrir: mostra as empresas mais recentes.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    void (async () => {
      const n = ++ultimaBusca.current;
      const r = await buscarEmpresas("");
      if (!vivo || n !== ultimaBusca.current) return;
      if (r.ok) setEmpresas(r.empresas);
      else setErro(r.erro);
    })();
    return () => {
      vivo = false;
      if (espera.current) window.clearTimeout(espera.current);
    };
  }, [aberto]);

  const aoDigitar = (t: string) => {
    setTermo(t);
    if (espera.current) window.clearTimeout(espera.current);
    espera.current = window.setTimeout(() => void buscar(t.trim()), ESPERA_BUSCA_MS);
  };

  const usar = async (empresaId: string | null) => {
    setSalvando(true);
    setErro(null);
    const r = await vincularEmpresa(assessmentId, empresaId);
    if (!r.ok) {
      setSalvando(false);
      return setErro(r.erro);
    }
    setAberto(false);
    setSalvando(false);
    router.refresh();
  };

  if (!aberto) {
    return (
      <>
        {vinculada && (
          <p className="empresa-escolhida">
            Empresa: <strong>{vinculada.nome}</strong>
            {vinculada.local ? ` (${vinculada.local})` : ""}{" "}
            <button type="button" className="btn-link" onClick={() => setAberto(true)}>
              Trocar empresa
            </button>
          </p>
        )}
        {children}
      </>
    );
  }

  return (
    <section className="empresa-escolha" aria-labelledby="empresa-escolha-titulo">
      <h2 id="empresa-escolha-titulo" className="pergunta-titulo">
        De qual empresa é este assessment?
      </h2>
      <div className="field">
        <label htmlFor="empresa-busca">Buscar empresa cadastrada</label>
        <input
          id="empresa-busca"
          type="search"
          autoComplete="off"
          maxLength={100}
          placeholder="Nome, cidade ou CNPJ"
          value={termo}
          onChange={(e) => aoDigitar(e.target.value)}
        />
      </div>

      {empresas === null ? (
        <p className="field-hint">Carregando…</p>
      ) : empresas.length === 0 ? (
        <p className="field-hint">{termo.trim() ? "Nenhuma empresa encontrada." : "Nenhuma empresa cadastrada ainda."}</p>
      ) : (
        <ul className="empresa-resultados">
          {empresas.map((e) => (
            <li key={e.id}>
              <span>
                <strong>{e.nome}</strong>
                {e.cidade || e.uf ? ` · ${[e.cidade, e.uf].filter(Boolean).join("/")}` : ""}
                {e.cnpj ? ` · ${formatarCnpj(e.cnpj)}` : ""}
                {e.contatoNome ? <span className="field-hint"> · contato: {e.contatoNome}</span> : null}
              </span>
              <button type="button" className="btn btn-inline btn-secondary" disabled={salvando} onClick={() => void usar(e.id)}>
                Usar esta empresa
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="escuta-linha">
        <button type="button" className="btn btn-inline" disabled={salvando} onClick={() => (vinculada ? void usar(null) : setAberto(false))}>
          Cadastrar empresa nova
        </button>
        {vinculada && (
          <button type="button" className="btn btn-inline btn-secondary" disabled={salvando} onClick={() => setAberto(false)}>
            Manter {vinculada.nome}
          </button>
        )}
      </div>
      <p className="field-hint">Uma empresa nova entra no cadastro quando este assessment for concluído.</p>
      {erro && (
        <p className="field-error" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
