import Link from "next/link";

interface Props {
  assessmentId: string;
  titulo: string;
  detalhe?: string | null;
  /** Modo atual; null esconde a troca (sem assistente configurado ou só leitura). */
  modo: "conversa" | "formulario" | null;
}

/**
 * Cabeçalho da área de trabalho do Self: volta para a lista, nome da empresa
 * e a troca entre conversa e formulário como abas (links comuns: funcionam
 * sem JavaScript e o voltar do navegador continua previsível).
 */
export function CabecalhoSelf({ assessmentId, titulo, detalhe, modo }: Props) {
  return (
    <header className="as-trabalho-topo">
      <div className="as-trabalho-titulo">
        <Link href="/assessment" className="as-voltar">
          <span aria-hidden="true">←</span> Self assessment
        </Link>
        <h1>{titulo}</h1>
        {detalhe && <p className="as-meta">{detalhe}</p>}
      </div>
      {modo && (
        <nav className="as-abas" aria-label="Como responder">
          <Link href={`/assessment/${assessmentId}`} aria-current={modo === "conversa" ? "page" : undefined}>
            Conversa
          </Link>
          <Link href={`/assessment/${assessmentId}?modo=formulario`} aria-current={modo === "formulario" ? "page" : undefined}>
            Formulário
          </Link>
        </nav>
      )}
    </header>
  );
}
