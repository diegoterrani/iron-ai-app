"use client";

import { useActionState, useState, useTransition } from "react";
import { concluirCadastroMfa, iniciarCadastroMfa, type MfaState } from "@/app/mfa-actions";
import { CodigoField } from "@/app/verificar-mfa/form";

export function CadastroMfa() {
  const [inicio, setInicio] = useState<MfaState | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, action, pending] = useActionState<MfaState, FormData>(concluirCadastroMfa, {});

  if (state.done) {
    return (
      <p className="notice" role="status">
        Pronto: a verificação em duas etapas está ativa.
      </p>
    );
  }

  if (!inicio?.factorId) {
    return (
      <>
        {inicio?.message && (
          <p className="notice notice-error" role="alert">
            {inicio.message}
          </p>
        )}
        <button
          type="button"
          className="btn"
          disabled={starting}
          onClick={() => startTransition(async () => setInicio(await iniciarCadastroMfa()))}
        >
          {starting ? "Gerando…" : "Ativar app autenticador"}
        </button>
      </>
    );
  }

  return (
    <form action={action} className="form" noValidate>
      <p>1. Escaneie o QR code no app autenticador.</p>
      {/* QR code em data URI SVG gerado pelo Supabase (img-src data: na CSP). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={inicio.qrCode} alt="QR code para o app autenticador" width={180} height={180} />
      <p className="field-hint">
        Sem câmera? Digite a chave: <code>{inicio.secret}</code>
      </p>
      <p>2. Digite o código que o app mostrar.</p>
      <input type="hidden" name="factorId" value={inicio.factorId} />
      {state.message && (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      )}
      <CodigoField />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Ativando…" : "Ativar"}
      </button>
    </form>
  );
}
