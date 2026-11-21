/**
 * Quem está falando, no texto dos blocos da escuta (roda no navegador).
 *
 * O Worker rotula as linhas por canal e voz: "Sala", "Sala · voz 2",
 * "Remoto". A tela troca pelo papel antes de enviar ao servidor:
 * - reunião por chamada: o microfone é só o consultor e a aba é o cliente;
 * - presencial: a voz que o consultor marcou com "Sou eu" é o consultor;
 *   as outras vozes da sala são o cliente.
 * Nenhuma impressão de voz é guardada: o número da voz vale só para a
 * conexão atual (o Worker recomeça a contagem a cada conexão).
 */

export interface Papeis {
  /** Reunião por chamada: o microfone tem só a voz do consultor. */
  chamada: boolean;
  /** Presencial: número da voz do consultor nesta conexão (o "voz N" do rótulo é N = falante + 1). */
  vozConsultor: number | null;
}

const LINHA = /^(Sala · voz (\d{1,2})|Sala|Remoto): /;

/** Troca o rótulo de cada linha pelo papel de quem fala. Texto fora do rótulo não muda. */
export function rotularBloco(texto: string, p: Papeis): string {
  return texto
    .split("\n")
    .map((linha) => {
      const m = LINHA.exec(linha);
      if (!m) return linha;
      const resto = linha.slice(m[0].length);
      const voz = m[2] === undefined ? null : Number(m[2]) - 1;
      let rotulo: string;
      if (m[1] === "Remoto") rotulo = "Cliente";
      else if (p.chamada) rotulo = "Consultor";
      else if (voz !== null && p.vozConsultor !== null) rotulo = voz === p.vozConsultor ? "Consultor" : `Cliente (voz ${voz + 1})`;
      else if (voz !== null) rotulo = `Sala (voz ${voz + 1})`;
      else rotulo = "Sala";
      return `${rotulo}: ${resto}`;
    })
    .join("\n");
}

/** Canal do bloco no banco: "remoto" só quando todas as linhas vêm da aba. */
export function canalDoBloco(texto: string): "sala" | "remoto" {
  const rotulos = texto.split("\n").flatMap((l) => {
    const m = LINHA.exec(l);
    return m ? [m[1]] : [];
  });
  return rotulos.length > 0 && rotulos.every((r) => r === "Remoto") ? "remoto" : "sala";
}

/** Marco zero da numeração: 01/11/2026 (UTC). */
const MARCO_MS = Date.UTC(2026, 10, 1);
export const MAX_SEQ = 2_000_000_000;

/**
 * Número do bloco no banco: décimos de segundo desde o marco, sempre maior
 * que o anterior. Não colide entre conexões nem entre abas da mesma pessoa
 * em momentos diferentes, e reenviar o mesmo bloco reusa o mesmo número.
 */
export function proximoSeq(anterior: number, agoraMs: number): number {
  const base = Math.floor((agoraMs - MARCO_MS) / 100);
  return Math.min(MAX_SEQ, Math.max(anterior + 1, base, 1));
}
