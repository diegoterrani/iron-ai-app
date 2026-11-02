"use client";

import { useActionState } from "react";
import { Field } from "@/components/field";
import { Turnstile } from "@/components/turnstile";
import { cadastrar, type FormState } from "../actions";

export function CadastroForm({ siteKey, nonce }: { siteKey: string; nonce?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cadastrar, {});
  return (
    <form action={action} className="form" noValidate>
      {state.message && (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      )}
      <Field name="nome" label="Nome" autoComplete="name" error={state.errors?.nome} />
      <Field name="email" label="E-mail" type="email" autoComplete="email" error={state.errors?.email} />
      <Field
        name="senha"
        label="Senha"
        type="password"
        autoComplete="new-password"
        hint="Pelo menos 12 caracteres. Uma frase longa funciona bem."
        error={state.errors?.senha}
      />
      <div className="check">
        <input id="aceiteTermos" name="aceiteTermos" type="checkbox" required aria-invalid={state.errors?.aceiteTermos ? true : undefined} />
        <label htmlFor="aceiteTermos">
          Li e aceito os{" "}
          <a href="https://iron-ai.io/politica-de-privacidade.html">Termos e a Política de Privacidade</a>.
        </label>
      </div>
      {state.errors?.aceiteTermos && (
        <p className="field-error" role="alert">
          {state.errors.aceiteTermos}
        </p>
      )}
      <div className="check">
        <input id="aceiteMarketing" name="aceiteMarketing" type="checkbox" />
        <label htmlFor="aceiteMarketing">Quero receber novidades da IRON AI por e-mail (opcional).</label>
      </div>
      <Turnstile siteKey={siteKey} nonce={nonce} resetKey={state} />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Criando…" : "Criar conta"}
      </button>
    </form>
  );
}
