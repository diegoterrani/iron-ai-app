"use client";

import { useActionState } from "react";
import { verificarMfa, type MfaState } from "@/app/mfa-actions";

export function VerificarMfaForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<MfaState, FormData>(verificarMfa, {});
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.message && (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      )}
      <CodigoField />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Verificando…" : "Verificar"}
      </button>
    </form>
  );
}

export function CodigoField() {
  return (
    <div className="field">
      <label htmlFor="codigo">Código</label>
      <input
        id="codigo"
        name="codigo"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
      />
    </div>
  );
}
