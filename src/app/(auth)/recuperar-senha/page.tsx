import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cspNonce } from "@/lib/auth/request";
import { RecuperarForm } from "./form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default async function RecuperarPage() {
  await connection();
  return (
    <>
      <h1 className="auth-title">Recuperar senha</h1>
      <p className="auth-lead">Informe seu e-mail e enviaremos um link para criar uma nova senha.</p>
      <RecuperarForm siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} nonce={await cspNonce()} />
      <p className="auth-links">
        <Link href="/entrar">Voltar para entrar</Link>
      </p>
    </>
  );
}
