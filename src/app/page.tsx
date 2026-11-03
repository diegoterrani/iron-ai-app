import Link from "next/link";
import { connection } from "next/server";

/**
 * Página inicial da área do cliente: leva para entrar ou criar conta.
 * `connection()` força renderização por requisição, exigida pelo nonce da CSP.
 */
export default async function Home() {
  await connection();
  return (
    <main className="shell">
      <header className="home-header">
        {/* SVG estático: <img> simples evita o atributo style que o next/image
            injeta e que a CSP estrita bloquearia. */}
        {/* O logo leva à home do site institucional (fora do app). */}
        <a href="https://iron-ai.io" className="home-brand" aria-label="IRON AI, página inicial do site">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-lockup.svg" alt="" width={147} height={44} />
        </a>
        <Link href="/entrar">Entrar</Link>
      </header>
      <p className="eyebrow hero-eyebrow">Área do cliente</p>
      <h1 className="title">Cursos, comunidade e assessments de IA.</h1>
      <p className="lead">
        Acesse seus cursos, o fórum da comunidade e os assessments da sua empresa. Novos cadastros são liberados
        pela equipe IRON AI.
      </p>
      <div className="home-ctas">
        <Link href="/entrar" className="btn btn-inline btn-link">
          Entrar
        </Link>
        <Link href="/cadastro" className="btn btn-inline btn-secondary btn-link">
          Criar conta
        </Link>
      </div>
      <div className="panel">
        <p className="panel-text">
          Dúvidas? Fale com a equipe pelo <a href="https://iron-ai.io/contato.html">formulário de contato</a>.
        </p>
      </div>
    </main>
  );
}
