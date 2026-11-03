"use client";

import { useActionState } from "react";
import { Field } from "@/components/field";
import { Turnstile } from "@/components/turnstile";
import { recuperarSenha, type FormState } from "../actions";

export function RecuperarForm({ siteKey, nonce }: { siteKey: string; nonce?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recuperarSenha, {});
  if (state.ok) {
    return (
      <p className="notice" role="status">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="form" noValidate>
      {state.message && (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      )}
      <Field name="email" label="E-mail" type="email" autoComplete="email" error={state.errors?.email} />
      <Turnstile siteKey={siteKey} nonce={nonce} resetKey={state} />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Enviando…" : "Enviar link"}
      </button>
    </form>
  );
}
