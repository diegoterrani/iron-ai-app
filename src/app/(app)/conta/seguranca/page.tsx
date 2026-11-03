import type { Metadata } from "next";
import { fatorTotpVerificado } from "@/lib/auth/mfa";
import { exigirContaAtiva } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CadastroMfa } from "./cadastro-mfa";

export const metadata: Metadata = { title: "Segurança da conta" };

export default async function SegurancaPage() {
  await exigirContaAtiva();
  const fator = await fatorTotpVerificado(await createClient());

  return (
    <main>
      <p className="eyebrow">Conta</p>
      <h1 className="title">Segurança</h1>
      <section className="panel">
        <h2 className="auth-title">Verificação em duas etapas</h2>
        {fator ? (
          <p className="lead">Ativa com app autenticador desde {new Date(fator.created_at).toLocaleDateString("pt-BR")}.</p>
        ) : (
          <>
            <p className="lead">
              Proteja sua conta com um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password).
            </p>
            <CadastroMfa />
          </>
        )}
      </section>
    </main>
  );
}
