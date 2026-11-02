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
