"use client";

/** Botão de impressão (o navegador oferece "Salvar como PDF"). */
export function BotaoImprimir() {
  return (
    <button type="button" className="btn btn-inline btn-secondary nao-imprimir" onClick={() => window.print()}>
      Imprimir ou salvar em PDF
    </button>
  );
}
