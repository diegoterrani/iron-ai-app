"use client";

import { useActionState, type ReactNode } from "react";
import type { AcaoState } from "@/lib/acao/tipos";

interface AcaoFormProps {
  action: (prev: AcaoState, form: FormData) => Promise<AcaoState>;
  /** Campos ocultos (ids) da operação. */
  campos?: Record<string, string>;
  rotulo: string;
  rotuloEnviando?: string;
  variante?: "primario" | "secundario" | "perigo";
  children?: ReactNode;
  className?: string;
}

/**
 * Formulário de uma operação do backoffice com retorno acessível
 * (role=status / role=alert). Funciona sem JavaScript também.
 */
export function AcaoForm({
  action,
  campos = {},
  rotulo,
  rotuloEnviando = "Salvando…",
  variante = "primario",
  children,
  className = "acao-form",
}: AcaoFormProps) {
  const [state, formAction, pending] = useActionState<AcaoState, FormData>(action, {});
  const classeBotao = { primario: "btn btn-inline", secundario: "btn btn-inline btn-secondary", perigo: "btn btn-inline btn-danger" }[variante];
  const erroCampos = state.errors ? Object.values(state.errors) : [];

  return (
    <form action={formAction} className={className} noValidate>
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      {children}
      <button type="submit" className={classeBotao} disabled={pending}>
        {pending ? rotuloEnviando : rotulo}
      </button>
      {state.message && (
        <p className={state.ok ? "acao-msg" : "acao-msg acao-msg-erro"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
      {erroCampos.length > 0 && (
        <p className="acao-msg acao-msg-erro" role="alert">
          {erroCampos.join(" ")}
        </p>
      )}
    </form>
  );
}
