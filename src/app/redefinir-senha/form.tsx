"use client";

import { useActionState } from "react";
import { Field } from "@/components/field";
import { redefinirSenha, type FormState } from "@/app/(auth)/actions";

export function RedefinirForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(redefinirSenha, {});
  return (
    <form action={action} className="form" noValidate>
      {state.message && (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      )}
      <Field
        name="senha"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        hint="Pelo menos 12 caracteres."
        error={state.errors?.senha}
      />
      <Field
        name="confirmacao"
        label="Repita a nova senha"
        type="password"
        autoComplete="new-password"
        error={state.errors?.confirmacao}
      />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Salvando…" : "Salvar senha"}
      </button>
    </form>
  );
}
