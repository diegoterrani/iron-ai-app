/**
 * Máscara de dados sensíveis no texto digitado pelo analista, ANTES de ir ao
 * modelo e ao banco (doc do Deep, seção Segurança): CPF, CNPJ, número de
 * cartão e dados bancários (agência, conta, chave Pix) não saem do servidor.
 *
 * A máscara troca o dado por um marcador fixo, então a transcrição gravada
 * também fica sem o número. Valores em reais (R$ 180.000,00), percentuais e
 * contagens continuam como estão: são a matéria-prima do assessment.
 */

export interface TextoMascarado {
  texto: string;
  /** Quantos dados foram mascarados, por tipo (vai ao log, sem o dado). */
  contagem: Record<TipoMascara, number>;
}

export type TipoMascara = "cpf" | "cnpj" | "cartao" | "banco" | "pix";

const MARCADOR: Record<TipoMascara, string> = {
  cpf: "[CPF removido]",
  cnpj: "[CNPJ removido]",
  cartao: "[cartão removido]",
  banco: "[dado bancário removido]",
  pix: "[chave Pix removida]",
};

/**
 * Ordem importa: o mais específico primeiro, para um CNPJ não virar CPF
 * pela metade. Os limites (nem dígito, nem pontuação colada a dígito, dos
 * dois lados) evitam pegar parte de um número maior, como um valor em reais
 * ou um código de barras, e aceitam o ponto final da frase.
 */
const REGRAS: { tipo: TipoMascara; re: RegExp }[] = [
  // Chave Pix declarada: "pix 123...", "chave pix: fulano@x.com".
  { tipo: "pix", re: /\b(?:chave\s+)?pix\s*[:=-]?\s*[^\s,;]{5,}/gi },
  // Agência e conta: "ag 1234", "agência 1234-5", "conta 12345-6", "c/c 123456".
  { tipo: "banco", re: /\b(?:ag(?:[eê]ncia)?|conta(?:\s+corrente)?|c\/c|cc)\.?\s*(?:n[ºo°.]?\s*)?[:=-]?\s*\d[\d.\- ]{2,14}\d(?:-[\dxX])?/gi },
  // CNPJ com ou sem pontuação.
  { tipo: "cnpj", re: /(?<!\d|\d[.,/-])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d|[.,/-]\d)/g },
  // Cartão: 13 a 19 dígitos, em grupos de 4 com espaço ou hífen, ou corrido.
  { tipo: "cartao", re: /(?<!\d|\d[.,/-])(?:\d{4}[ -]){3}\d{1,7}(?!\d|[.,/-]\d)|(?<!\d|\d[.,/-])\d{13,19}(?!\d|[.,/-]\d)/g },
  // CPF com ou sem pontuação (11 dígitos).
  { tipo: "cpf", re: /(?<!\d|\d[.,/-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d|[.,/-]\d)/g },
];

export function mascararDadosSensiveis(entrada: string): TextoMascarado {
  const contagem: Record<TipoMascara, number> = { cpf: 0, cnpj: 0, cartao: 0, banco: 0, pix: 0 };
  let texto = entrada;
  for (const { tipo, re } of REGRAS) {
    texto = texto.replace(re, () => {
      contagem[tipo]++;
      return MARCADOR[tipo];
    });
  }
  return { texto, contagem };
}
