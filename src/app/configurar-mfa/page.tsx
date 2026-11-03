import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CadastroMfa } from "@/app/(app)/conta/seguranca/cadastro-mfa";
import { SairButton } from "@/components/sair-button";
import { exigirLogin, getSessao } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Ative a verificação em duas etapas" };

/** Obrigatório para Super-admin e Equipe IRON antes de usar a plataforma. */
export default async function ConfigurarMfaPage() {
  await exigirLogin();
  const sessao = await getSessao();
  if (!sessao?.precisaCadastrarMfa) redirect("/painel");

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Ative a verificação em duas etapas</h1>
        <p className="auth-lead">
          Seu perfil tem acesso administrativo. Por segurança, ele só funciona com app autenticador.
        </p>
        <CadastroMfa />
        <p className="auth-links">
          Depois de ativar, <Link href="/painel">vá para o painel</Link>.
        </p>
        <SairButton />
      </section>
    </main>
  );
}
