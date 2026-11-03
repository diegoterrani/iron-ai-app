import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ConvitesPendentes } from "@/components/convites-pendentes";
import { SairButton } from "@/components/sair-button";
import { exigirLogin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Aguardando aprovação" };

export default async function AguardandoPage() {
  await connection();
  const perfil = await exigirLogin();
  if (perfil?.status === "ativo") redirect("/painel");

  const suspenso = perfil?.status === "suspenso";
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">{suspenso ? "Acesso suspenso" : "Aguardando aprovação"}</h1>
        <p className="auth-lead">
          {suspenso
            ? "Seu acesso está suspenso. Fale com a equipe IRON AI se achar que isso é um engano."
            : "Recebemos seu cadastro. A equipe IRON AI vai liberar o acesso e avisar por e-mail."}
        </p>
        {!suspenso && <ConvitesPendentes />}
        <p className="auth-links">
          <Link href="/meus-dados">Meus dados (LGPD)</Link>
        </p>
        <SairButton />
      </section>
    </main>
  );
}
