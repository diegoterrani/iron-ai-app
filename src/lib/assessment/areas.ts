/**
 * Escolha das áreas da pergunta 6, sem dependências de servidor: o motor e a
 * tela usam exatamente esta função, então a lista que o cliente vê é a mesma
 * que o servidor confere ao concluir.
 *
 * Potencial da área = peso × (5 − nota), em que peso = participação típica de
 * pessoas no setor × e_a base. Empate mantém a ordem dos candidatos.
 */
export function ordenarAreasQ6(
  candidatas: readonly string[],
  pesos: Readonly<Record<string, number>>,
  notas: Readonly<Record<string, number>>,
  quantidade: number,
): string[] {
  return candidatas
    .map((a) => ({ a, p: (Object.hasOwn(pesos, a) ? pesos[a] : 0) * (5 - notas[a]) }))
    .sort((x, y) => y.p - x.p)
    .slice(0, quantidade)
    .map((x) => x.a);
}

/**
 * Soma igual ao `sum()` do CPython 3.12+ (soma compensada de Neumaier), para
 * que TypeScript e Python cheguem ao mesmo número até a última casa.
 */
export function soma(valores: Iterable<number>): number {
  let f = 0;
  let c = 0;
  for (const x of valores) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  return c !== 0 && Number.isFinite(c) ? f + c : f;
}

/** Uma opção (texto, formato até o motor 0.2.1) ou várias (lista), sem repetição. */
export function listaMarcadas(valor: unknown): unknown[] {
  if (typeof valor === "string") return [valor];
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor)];
}

/**
 * Nota de uma resposta de escolha múltipla pela média das opções marcadas
 * (ex.: planilhas + sistema = 2,5). Devolve null se nada válido foi marcado.
 * O motor usa a mesma conta e recusa opção fora da lista.
 */
export function mediaMarcadas(tabela: Readonly<Record<string, number>>, valor: unknown): number | null {
  const lista = listaMarcadas(valor);
  if (lista.length === 0 || lista.some((v) => typeof v !== "string" || !Object.hasOwn(tabela, v))) return null;
  return soma(lista.map((v) => tabela[v as string])) / lista.length;
}
