"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface ItemNav {
  href: string;
  rotulo: string;
}

/**
 * A página atual é a do próprio link ou uma subpágina dele. `exato` serve
 * para links que são prefixo de outros (ex.: /admin e /admin/usuarios).
 */
export function linkAtivo(pathname: string, href: string, exato = false): boolean {
  if (pathname === href) return true;
  return !exato && pathname.startsWith(`${href}/`);
}

/** Links de navegação com aria-current na página em que a pessoa está. */
export function NavLinks({ itens, exatos = [] }: { itens: ItemNav[]; exatos?: string[] }) {
  const pathname = usePathname();
  return (
    <>
      {itens.map((i) => (
        <Link key={i.href} href={i.href} aria-current={linkAtivo(pathname, i.href, exatos.includes(i.href)) ? "page" : undefined}>
          {i.rotulo}
        </Link>
      ))}
    </>
  );
}
