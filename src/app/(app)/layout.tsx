import Link from "next/link";
import { connection } from "next/server";
import { SairButton } from "@/components/sair-button";
import { podeUsarBackoffice } from "@/lib/auth/admin";
import { eGestorDeEmpresa } from "@/lib/auth/empresa";
import { exigirContaAtiva } from "@/lib/auth/session";

/** Área logada: só contas ativas. O link do backoffice só aparece para super-admin com MFA. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const perfil = await exigirContaAtiva();
  const [admin, gestor] = await Promise.all([podeUsarBackoffice(), eGestorDeEmpresa()]);
  return (
    <div className="shell">
      <header className="app-header">
        <Link href="/painel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-lockup.svg" alt="IRON AI" width={147} height={44} />
        </Link>
        <div className="app-user">
          <span>{perfil.nome}</span>
          {gestor && <Link href="/empresa">Minha empresa</Link>}
          {admin && <Link href="/admin">Backoffice</Link>}
          <Link href="/conta/seguranca">Segurança</Link>
          <SairButton />
        </div>
      </header>
      {children}
    </div>
  );
}
