/**
 * Resposta consolidada da entrevista guiada por áudio (vale no navegador e no
 * servidor). O consultor revisa este texto antes de enviar à conversa.
 */

export interface RespostaConsolidada {
  /** A resposta à pergunta atual, como o cliente disse, organizada. */
  resposta: string;
  /** O que o cliente disse e responde outras perguntas do Self (uma linha cada). */
  tambem: string[];
  /** Dúvida ou ressalva para o consultor (não vai para a conversa). */
  observacao: string | null;
}

export const ROTULO_TAMBEM = "Também mencionou:";

/** Texto que o consultor revisa e envia à conversa. */
export function textoParaEnviar(c: RespostaConsolidada): string {
  const resposta = c.resposta.trim();
  if (c.tambem.length === 0) return resposta;
  return `${resposta}\n\n${ROTULO_TAMBEM}\n${c.tambem.map((t) => `- ${t.trim()}`).join("\n")}`;
}
