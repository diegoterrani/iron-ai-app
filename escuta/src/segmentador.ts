/**
 * Corta a transcrição contínua em blocos, um por "trecho de conversa".
 * Cada bloco vira, na Fase 3, uma fala automática para o agente do Deep.
 *
 * Sem rede, sem relógio próprio e sem estado fora do objeto: quem chama
 * informa a hora. Isso deixa as regras testáveis e iguais no teste e na
 * reunião real.
 *
 * Regras de fechamento:
 * - pausa: ninguém falou por `pausaMs` e o bloco já tem conteúdo útil;
 * - tamanho: o bloco chegou ao teto (a fala do agente aceita 4.000
 *   caracteres; o teto fica abaixo para sobrar margem).
 */

export type Canal = "microfone" | "aba";

export interface FalaFinal {
  canal: Canal;
  texto: string;
}

export interface Bloco {
  numero: number;
  texto: string;
  motivo: "pausa" | "tamanho" | "encerramento";
}

export interface OpcoesSegmentador {
  pausaMs: number;
  minCaracteres: number;
  maxCaracteres: number;
}

export const OPCOES_PADRAO: OpcoesSegmentador = { pausaMs: 6000, minCaracteres: 40, maxCaracteres: 3500 };

/** Espaço mínimo que vale a pena preencher antes de fechar um bloco. */
const MARGEM_MINIMA = 80;

const ROTULO: Record<Canal, string> = { microfone: "Sala", aba: "Remoto" };

export class Segmentador {
  private linhas: { canal: Canal; texto: string }[] = [];
  private tamanho = 0;
  private ultimaFalaMs: number | null = null;
  private numero = 0;

  constructor(private readonly opcoes: OpcoesSegmentador = OPCOES_PADRAO) {
    if (opcoes.minCaracteres < 1 || opcoes.maxCaracteres <= opcoes.minCaracteres || opcoes.pausaMs < 1) {
      throw new Error("opções do segmentador inválidas");
    }
  }

  /** Acrescenta uma fala final. Devolve os blocos que fecharam por tamanho. */
  adicionar(fala: FalaFinal, agoraMs: number): Bloco[] {
    const fechados: Bloco[] = [];
    let resto = fala.texto.replace(/\s+/g, " ").trim();
    if (!resto) return fechados;
    this.ultimaFalaMs = agoraMs;

    while (resto) {
      // Custo de uma linha nova: "Rótulo: " + quebra de linha.
      const prefixo = this.mesmaLinha(fala.canal) ? 1 : ROTULO[fala.canal].length + 3;
      const cabe = this.opcoes.maxCaracteres - this.tamanho - prefixo;
      // Sobra pouco espaço e o texto não cabe inteiro: melhor fechar o bloco
      // do que deixar três palavras soltas no fim dele.
      if (cabe < 1 || (this.tamanho > 0 && cabe < MARGEM_MINIMA && resto.length > cabe)) {
        fechados.push(this.fechar("tamanho"));
        continue;
      }
      const pedaco = cortarEmPalavra(resto, cabe);
      this.acrescentar(fala.canal, pedaco);
      resto = resto.slice(pedaco.length).trim();
      if (resto) fechados.push(this.fechar("tamanho"));
    }
    return fechados;
  }

  /** Chamar periodicamente: fecha o bloco se a pausa passou do limite. */
  verificar(agoraMs: number): Bloco | null {
    if (this.ultimaFalaMs === null || this.tamanho < this.opcoes.minCaracteres) return null;
    if (agoraMs - this.ultimaFalaMs < this.opcoes.pausaMs) return null;
    return this.fechar("pausa");
  }

  /** Fim da escuta: entrega o que sobrou, mesmo curto. */
  encerrar(): Bloco | null {
    return this.tamanho > 0 ? this.fechar("encerramento") : null;
  }

  private mesmaLinha(canal: Canal): boolean {
    return this.linhas.at(-1)?.canal === canal;
  }

  private acrescentar(canal: Canal, texto: string): void {
    const ultima = this.linhas.at(-1);
    if (ultima && ultima.canal === canal) {
      ultima.texto += ` ${texto}`;
      this.tamanho += texto.length + 1;
    } else {
      this.linhas.push({ canal, texto });
      this.tamanho += texto.length + ROTULO[canal].length + 3;
    }
  }

  private fechar(motivo: Bloco["motivo"]): Bloco {
    const texto = this.linhas.map((l) => `${ROTULO[l.canal]}: ${l.texto}`).join("\n");
    this.linhas = [];
    this.tamanho = 0;
    this.ultimaFalaMs = null;
    this.numero += 1;
    return { numero: this.numero, texto, motivo };
  }
}

/** Corta no último espaço que cabe; palavra maior que o limite é cortada no limite. */
function cortarEmPalavra(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const corte = texto.lastIndexOf(" ", limite);
  return corte > 0 ? texto.slice(0, corte) : texto.slice(0, limite);
}
