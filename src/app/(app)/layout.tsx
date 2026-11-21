import { connection } from "next/server";
import { CabecalhoApp } from "@/components/cabecalho-app";
import { exigirContaAtiva } from "@/lib/auth/session";

/** Área logada: só contas ativas. Os links do cabeçalho dependem do perfil. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const perfil = await exigirContaAtiva();
  return (
    <div className="shell">
      <CabecalhoApp perfil={perfil} />
      {children}
    </div>
  );
}
