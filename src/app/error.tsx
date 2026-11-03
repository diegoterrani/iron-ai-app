"use client";

/** Erro inesperado: mensagem genérica; o detalhe fica só no log do servidor. */
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Algo deu errado</h1>
        <p className="auth-lead">
          Tente de novo em instantes.{error.digest ? ` Se persistir, informe o código ${error.digest}.` : ""}
        </p>
        <button type="button" className="btn" onClick={reset}>
          Tentar de novo
        </button>
      </section>
    </main>
  );
}
