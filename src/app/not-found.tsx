import Link from "next/link";
import { getSessao } from "@/lib/auth/session";

/** 404: quem está logado volta ao painel; quem não está, à tela de entrar. */
export default async function NaoEncontrado() {
  const logado = Boolean(await getSessao());
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Página não encontrada</h1>
        <p className="auth-lead">O endereço pode ter mudado ou não existir.</p>
        {logado ? <Link href="/painel">Ir para o painel</Link> : <Link href="/entrar">Entrar</Link>}
      </section>
    </main>
  );
}
