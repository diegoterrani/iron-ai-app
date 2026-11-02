import { connection } from "next/server";

/**
 * Página inicial provisória (fase 0). O login entra na fase 1.
 * `connection()` força renderização por requisição, exigida pelo nonce da CSP.
 */
export default async function Home() {
  await connection();
  return (
    <main className="shell">
      {/* SVG estático: <img> simples evita o atributo style que o next/image
          injeta e que a CSP estrita bloquearia. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-lockup.svg" alt="IRON AI" width={147} height={44} />
      <p className="eyebrow hero-eyebrow">Área do cliente</p>
      <h1 className="title">Em construção.</h1>
      <p className="lead">
        Aqui ficarão os cursos, a comunidade e os assessments da IRON AI.
        O acesso será liberado em breve.
      </p>
      <div className="panel">
        <p className="panel-text">
          Enquanto isso, fale com a equipe pelo{" "}
          <a href="https://iron-ai.io/contato.html">formulário de contato</a>.
        </p>
      </div>
    </main>
  );
}
