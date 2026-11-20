import Link from "next/link";
import { connection } from "next/server";
import { SairButton } from "@/components/sair-button";
import { podeUsarBackoffice } from "@/lib/auth/admin";
import { eAnalistaDeep } from "@/lib/auth/deep";
import { eGestorDeEmpresa } from "@/lib/auth/empresa";
import { exigirContaAtiva } from "@/lib/auth/session";

/** Área logada: só contas ativas. O link do backoffice só aparece para super-admin com MFA; o do Deep, para a equipe IRON. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const perfil = await exigirContaAtiva();
  const [admin, gestor, analista] = await Promise.all([podeUsarBackoffice(), eGestorDeEmpresa(), eAnalistaDeep()]);
  return (
    <div className="shell">
      <header className="app-header">
        <Link href="/painel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-lockup.svg" alt="IRON AI" width={147} height={44} />
        </Link>
        <div className="app-user">
          <span>{perfil.nome}</span>
          <Link href="/assessment">Self assessment</Link>
          {analista && <Link href="/deep">Deep assessment</Link>}
          {gestor && <Link href="/empresa">Minha empresa</Link>}
          {admin && <Link href="/admin">Backoffice</Link>}
          <Link href="/conta/seguranca">Segurança</Link>
          <Link href="/meus-dados">Meus dados</Link>
          <SairButton />
        </div>
      </header>
      {children}
    </div>
  );
}
