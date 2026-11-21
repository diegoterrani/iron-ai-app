import Link from "next/link";
import { SairButton } from "@/components/sair-button";
import { podeUsarBackoffice } from "@/lib/auth/admin";
import { eAnalistaDeep } from "@/lib/auth/deep";
import { eGestorDeEmpresa } from "@/lib/auth/empresa";
import type { Perfil } from "@/lib/auth/session";
import { MenuApp } from "./menu-app";
import type { ItemNav } from "./nav-links";

/**
 * Cabeçalho da área logada (conta ativa). Os links só aparecem para quem
 * pode usá-los; quem decide o acesso de verdade são as páginas e o banco.
 */
export async function CabecalhoApp({ perfil }: { perfil: Perfil }) {
  const [admin, gestor, analista] = await Promise.all([podeUsarBackoffice(), eGestorDeEmpresa(), eAnalistaDeep()]);
  const produtos: ItemNav[] = [
    { href: "/painel", rotulo: "Painel" },
    { href: "/assessment", rotulo: "Self assessment" },
    ...(analista ? [{ href: "/deep", rotulo: "Deep assessment" }] : []),
    ...(gestor ? [{ href: "/empresa", rotulo: "Minha empresa" }] : []),
    ...(admin ? [{ href: "/admin", rotulo: "Backoffice" }] : []),
  ];
  const conta: ItemNav[] = [
    { href: "/conta/seguranca", rotulo: "Segurança" },
    { href: "/meus-dados", rotulo: "Meus dados" },
  ];
  return (
    <header className="app-header">
      <Link href="/painel" className="app-marca">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-lockup.svg" alt="IRON AI, painel" width={147} height={44} />
      </Link>
      <MenuApp nome={perfil.nome} produtos={produtos} conta={conta} sair={<SairButton />} />
    </header>
  );
}
