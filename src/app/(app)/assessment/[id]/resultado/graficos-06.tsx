import type { Certeza } from "@/lib/assessment/v06/tipos";

/**
 * Peças visuais do relatório 0.6, sem JavaScript no navegador e sem `style`
 * inline (CSP): o tamanho de cada barra vai em atributos do SVG (width/x em
 * %), as cores vêm de classes no CSS. Textos ficam em HTML, para continuarem
 * legíveis no celular e para leitor de tela; o SVG é decorativo (aria-hidden).
 */

/** Fração (0 a 1) como porcentagem de atributo SVG. Fora da faixa vira 0 ou 100%. */
export const emPct = (f: number) => `${(Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0)) * 100).toFixed(2)}%`;

export const classeCerteza = (c: Certeza) => `g-${c}`;

/** Uma barra horizontal: fundo, um trecho opcional mais claro (até `ate`) e o valor. */
export function Barra({ fracao, ate, classe, alta = false }: { fracao: number; ate?: number; classe: string; alta?: boolean }) {
  return (
    <svg className={alta ? "g-barra g-barra-alta" : "g-barra"} aria-hidden="true" focusable="false">
      <rect className="g-fundo" x="0" y="0" width="100%" height="100%" />
      {ate !== undefined && ate > fracao && <rect className={`${classe} g-claro`} x="0" y="0" width={emPct(ate)} height="100%" />}
      <rect className={classe} x="0" y="0" width={emPct(fracao)} height="100%" />
    </svg>
  );
}

/** Barra 100% empilhada: cada fatia com a sua classe de cor, na ordem dada. */
export function BarraEmpilhada({ fatias }: { fatias: { fracao: number; classe: string; chave: string }[] }) {
  // Início de cada fatia = soma das anteriores (calculado antes de renderizar).
  const inicios = fatias.map((_, i) => fatias.slice(0, i).reduce((a, f) => a + f.fracao, 0));
  return (
    <svg className="g-barra g-barra-alta" aria-hidden="true" focusable="false">
      <rect className="g-fundo" x="0" y="0" width="100%" height="100%" />
      {fatias.map((f, i) => (
        <rect key={f.chave} className={f.classe} x={emPct(inicios[i])} y="0" width={emPct(f.fracao)} height="100%" />
      ))}
    </svg>
  );
}

/** Régua de retorno: escala de 0 a `max`, barra até o retorno e marca na meta. */
export function Regua({ retorno, alvo, max, classe }: { retorno: number; alvo: number; max: number; classe: string }) {
  const marcas = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <svg className="g-regua" aria-hidden="true" focusable="false">
      <rect className="g-fundo" x="0" y="14" width="100%" height="18" />
      <rect className={classe} x="0" y="14" width={emPct(retorno / max)} height="18" />
      <line className="g-meta" x1={emPct(alvo / max)} x2={emPct(alvo / max)} y1="6" y2="40" />
      {marcas.map((m) => (
        <text key={m} className="g-eixo" x={emPct(m / max)} y="56" textAnchor={m === 0 ? "start" : m === max ? "end" : "middle"}>
          {m}×
        </text>
      ))}
    </svg>
  );
}

/** Faixas de nível (fundo), o score (barra) e, se houver, a trava (linha tracejada). */
export function Escala({ niveis, score, teto }: { niveis: { de: number; ate: number; nome: string }[]; score: number; teto: number | null }) {
  return (
    <svg className="g-regua" aria-hidden="true" focusable="false">
      {niveis.map((n, i) => (
        <rect key={n.nome} className={`g-nivel g-nivel-${i}`} x={emPct(n.de)} y="14" width={emPct(n.ate - n.de)} height="18" />
      ))}
      <rect className="g-valor" x="0" y="19" width={emPct(score)} height="8" />
      {teto !== null && <line className="g-trava" x1={emPct(teto)} x2={emPct(teto)} y1="6" y2="40" />}
      {niveis.map((n) => (
        <text key={n.nome} className="g-eixo" x={emPct((n.de + n.ate) / 2)} y="56" textAnchor="middle">
          {n.nome}
        </text>
      ))}
    </svg>
  );
}
