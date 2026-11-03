"use client";

import { useActionState } from "react";
import { Field } from "@/components/field";
import { Turnstile } from "@/components/turnstile";
import { entrar, type FormState } from "../actions";

export function EntrarForm({ next, siteKey, nonce }: { next: string; siteKey: string; nonce?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(entrar, {});
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.message && (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      )}
      <Field name="email" label="E-mail" type="email" autoComplete="email" error={state.errors?.email} />
      <Field name="senha" label="Senha" type="password" autoComplete="current-password" error={state.errors?.senha} />
      <Turnstile siteKey={siteKey} nonce={nonce} resetKey={state} />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
