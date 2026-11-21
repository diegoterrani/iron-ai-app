import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { SairButton } from "@/components/sair-button";
import { exigirLogin, getSessao } from "@/lib/auth/session";
import { AceiteForm } from "./form";

export const metadata: Metadata = { title: "Termos e Política de Privacidade" };

/**
 * Primeiro acesso de quem entrou pelo Google ou por convite (ou depois de uma
 * nova versão dos Termos): o aceite vem antes de qualquer outra tela.
 */
export default async function AceitarTermosPage() {
  await connection();
  await exigirLogin({ permitirSemAceite: true });
  const sessao = await getSessao();
  if (!sessao?.precisaAceitarTermos) redirect("/painel");

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Boas-vindas</p>
        <h1 className="auth-title">Antes de continuar</h1>
        <p className="auth-lead">
          Para usar a área do cliente, confirme que leu e aceita os Termos e a Política de Privacidade da IRON AI.
        </p>
        <AceiteForm />
        <p className="auth-links">
          <Link href="/meus-dados">Meus dados (LGPD)</Link>
        </p>
        <SairButton />
      </section>
    </main>
  );
}
