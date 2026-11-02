import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Página não encontrada</h1>
        <p className="auth-lead">O endereço pode ter mudado ou não existir.</p>
        <Link href="/painel">Ir para o painel</Link>
      </section>
    </main>
  );
}
