import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Verifique seu e-mail" };

export default function VerifiqueEmailPage() {
  return (
    <>
      <h1 className="auth-title">Verifique seu e-mail</h1>
      <p className="auth-lead">
        Se o endereço for válido, enviamos um link de confirmação. Depois de confirmar, a equipe IRON AI libera o seu
        acesso.
      </p>
      <p className="auth-links">
        <Link href="/entrar">Voltar para entrar</Link>
      </p>
    </>
  );
}
