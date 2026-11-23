import { connection } from "next/server";
import { CabecalhoApp } from "@/components/cabecalho-app";
import { exigirContaAtiva } from "@/lib/auth/session";

/** Área logada: só contas ativas. Os links do cabeçalho dependem do perfil. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const perfil = await exigirContaAtiva();
  return (
    <div className="shell app-shell">
      <a href="#conteudo" className="pular-conteudo">
        Pular para o conteúdo
      </a>
      <CabecalhoApp perfil={perfil} />
      <div id="conteudo" className="app-conteudo">
        {children}
      </div>
    </div>
  );
}
