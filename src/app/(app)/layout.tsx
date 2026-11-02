import { connection } from "next/server";
import { SairButton } from "@/components/sair-button";
import { exigirContaAtiva } from "@/lib/auth/session";

/** Área logada: só contas ativas. Papéis e permissões entram na fase 2. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const perfil = await exigirContaAtiva();
  return (
    <div className="shell">
      <header className="app-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-lockup.svg" alt="IRON AI" width={147} height={44} />
        <div className="app-user">
          <span>{perfil.nome}</span>
          <SairButton />
        </div>
      </header>
      {children}
    </div>
  );
}
