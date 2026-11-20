import type { Progresso06 } from "@/lib/assessment/v06/questionario";

/**
 * Indicador de progresso do Self 0.6: quantos passos foram dados, quantos
 * faltam e qual é o próximo. Fica fixo no topo enquanto a pessoa rola.
 * As faixas são só visuais (aria-hidden); o texto carrega a informação para
 * leitor de tela, anunciada com educação (role="status").
 */
export function IndicadorProgresso06({ p }: { p: Progresso06 }) {
  const faltam = p.total - p.feitos;
  return (
    <div className="progresso-self">
      <p className="progresso-texto" role="status" aria-live="polite">
        <strong>
          {p.feitos} de {p.total} passos
        </strong>
        <span>{faltam === 0 ? "Tudo respondido: falta só confirmar." : `Faltam ${faltam}${p.proximo ? `. Próximo: ${p.proximo.nome.toLowerCase()}` : ""}.`}</span>
      </p>
      <ol className="progresso-faixas" aria-hidden="true">
        {p.passos.map((x) => (
          <li key={x.id} className={x.feito ? "feito" : x.id === p.proximo?.id ? "atual" : undefined} title={x.nome} />
        ))}
      </ol>
    </div>
  );
}
