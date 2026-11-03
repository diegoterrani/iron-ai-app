import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cspNonce } from "@/lib/auth/request";
import { ProviderButtons } from "../provider-buttons";
import { CadastroForm } from "./form";

export const metadata: Metadata = { title: "Criar conta" };

export default async function CadastroPage() {
  await connection();
  return (
    <>
      <p className="eyebrow">Área do cliente</p>
      <h1 className="auth-title">Criar conta</h1>
      <p className="auth-lead">
        Depois do cadastro, a equipe IRON AI libera o seu acesso. Você recebe um e-mail quando estiver pronto.
      </p>
      <ProviderButtons next="/painel" />
      <p className="divider">ou com e-mail</p>
      <CadastroForm siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} nonce={await cspNonce()} />
      <p className="auth-links">
        Já tem conta? <Link href="/entrar">Entrar</Link>
      </p>
    </>
  );
}
