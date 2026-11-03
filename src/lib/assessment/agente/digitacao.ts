/**
 * Efeito de digitação das falas do assistente, só na tela.
 *
 * A resposta chega inteira do servidor (o agente valida e grava antes de
 * responder); aqui ela é revelada palavra por palavra. Nada muda no que é
 * gravado ou enviado ao modelo.
 */

/** Intervalo entre um passo e outro da digitação, em milissegundos. */
export const INTERVALO_DIGITACAO_MS = 35;

/** Pausa entre um balão e o próximo, para a pergunta não colar na confirmação. */
export const PAUSA_ENTRE_BALOES_MS = 300;

/** Duração máxima de uma fala: textos longos avançam mais palavras por passo. */
export const DURACAO_MAXIMA_MS = 4000;

/**
 * Quebra o texto em pedaços que, somados, reconstroem o texto original.
 * Cada pedaço é uma palavra com o espaço (ou quebra de linha) que vem depois.
 * O marcador de lista "1. " fica junto da primeira palavra da opção, para a
 * lista numerada não aparecer como parágrafo solto no meio da digitação.
 */
export function pedacosDeDigitacao(texto: string): string[] {
  const brutos = texto.match(/\s*\S+\s*/g) ?? [];
  const pedacos: string[] = [];
  for (const p of brutos) {
    const anterior = pedacos[pedacos.length - 1];
    if (anterior !== undefined && /(^|\n)\s*\d{1,2}[.)]\s+$/.test(anterior)) {
      pedacos[pedacos.length - 1] = anterior + p;
    } else {
      pedacos.push(p);
    }
  }
  return pedacos;
}

/** Quantas palavras avançar por passo para a fala caber em DURACAO_MAXIMA_MS. */
export function palavrasPorPasso(totalPedacos: number): number {
  const passos = Math.floor(DURACAO_MAXIMA_MS / INTERVALO_DIGITACAO_MS);
  return Math.max(1, Math.ceil(totalPedacos / passos));
}

/** Texto visível depois de `quantos` pedaços revelados (sem espaço no fim). */
export function textoParcial(pedacos: string[], quantos: number): string {
  return pedacos.slice(0, quantos).join("").trimEnd();
}
