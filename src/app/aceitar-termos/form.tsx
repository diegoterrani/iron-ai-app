"use client";

import { useActionState } from "react";
import type { AcaoState } from "@/lib/acao/tipos";
import { aceitarTermos } from "./actions";

export function AceiteForm() {
  const [state, action, pending] = useActionState<AcaoState, FormData>(aceitarTermos, {});
  const erroTermos = state.errors?.aceiteTermos;
  return (
    <form action={action} className="form" noValidate>
      {state.message && (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      )}
      <div className="check">
        <input
          id="aceiteTermos"
          name="aceiteTermos"
          type="checkbox"
          required
          aria-invalid={erroTermos ? true : undefined}
          aria-describedby={erroTermos ? "aceiteTermos-erro" : undefined}
        />
        <label htmlFor="aceiteTermos">
          Li e aceito os{" "}
          <a href="https://iron-ai.io/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer">
            Termos e a Política de Privacidade
          </a>
          .
        </label>
      </div>
      {erroTermos && (
        <p id="aceiteTermos-erro" className="field-error" role="alert">
          {erroTermos}
        </p>
      )}
      <div className="check">
        <input id="aceiteMarketing" name="aceiteMarketing" type="checkbox" />
        <label htmlFor="aceiteMarketing">Quero receber novidades da IRON AI por e-mail (opcional).</label>
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Registrando…" : "Continuar"}
      </button>
    </form>
  );
}
