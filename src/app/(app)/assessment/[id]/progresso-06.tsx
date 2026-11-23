import type { Progresso06 } from "@/lib/assessment/v06/questionario";

/**
 * Indicador de progresso do Self 0.6: passos feitos, porcentagem e o próximo
 * passo. A barra é um <progress> nativo (acessível, sem estilo inline); o
 * texto é anunciado com educação (role="status").
 */
export function IndicadorProgresso06({ p, compacto = false }: { p: Progresso06; compacto?: boolean }) {
  const faltam = p.total - p.feitos;
  const pct = p.total > 0 ? Math.round((p.feitos / p.total) * 100) : 0;
  return (
    <div className={compacto ? "progresso-self progresso-compacto" : "progresso-self"}>
      <div className="progresso-topo">
        <strong>
          {p.feitos} de {p.total} passos
        </strong>
        <span aria-hidden="true">{pct}%</span>
      </div>
      <progress className="as-barra" max={p.total} value={p.feitos} aria-hidden="true" />
      <p className="progresso-texto" role="status" aria-live="polite">
        {faltam === 0 ? "Tudo respondido: falta só confirmar." : p.proximo ? `Próximo: ${p.proximo.nome.toLowerCase()}.` : `Faltam ${faltam}.`}
      </p>
    </div>
  );
}
