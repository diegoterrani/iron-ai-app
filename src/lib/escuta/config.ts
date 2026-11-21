/**
 * Escuta (áudio) do Self: valores públicos, usados pela tela e pela CSP.
 * O endereço do Worker não é segredo; o que protege a escuta é o token curto
 * que só o servidor emite (src/lib/escuta/token.ts) e a origem conferida no
 * Worker.
 */

export const ORIGEM_ESCUTA = "wss://iron-ai-escuta.contato-bd2.workers.dev";
export const ENDERECO_ESCUTA = `${ORIGEM_ESCUTA}/escuta`;
/** Subprotocolo do WebSocket; o token vai como segundo subprotocolo (fora da URL). */
export const PROTOCOLO_ESCUTA = "escuta.v1";

/** Minutos reservados no banco a cada token (o Worker aceita token de até 10 min). */
export const MINUTOS_POR_TOKEN = 10;

/** Versão do texto de consentimento: muda quando o texto muda (fica registrada no banco). */
export const VERSAO_CONSENTIMENTO = "self-escuta@1";

/** Texto lido para as pessoas presentes antes de ligar o áudio. */
export const TEXTO_CONSENTIMENTO = [
  "Vamos ligar o assistente de áudio da IRON AI nesta conversa.",
  "O áudio é transcrito em tempo real (pela Cloudflare) e não é gravado. O texto transcrito fica guardado por até 90 dias e serve só para preencher este assessment, com a ajuda de um assistente de IA (Anthropic).",
  "Quem estiver na reunião pode pedir para desligar a qualquer momento.",
  "Não falem números de documentos, cartões ou contas: se alguém falar, o app remove antes de guardar.",
] as const;
