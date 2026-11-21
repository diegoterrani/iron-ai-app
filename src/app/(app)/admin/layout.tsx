import type { Metadata } from "next";
import { NavLinks } from "@/components/nav-links";
import { exigirSuperAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = { title: { template: "%s · Backoffice", default: "Backoffice" } };

/**
 * Backoffice: só super-admin com MFA (quem não é recebe 404).
 * O banco confere de novo em cada leitura (RLS) e operação (admin_*).
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await exigirSuperAdmin();
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Backoffice">
        <NavLinks
          exatos={["/admin"]}
          itens={[
            { href: "/admin", rotulo: "Visão geral" },
            { href: "/admin/usuarios", rotulo: "Usuários" },
            { href: "/admin/empresas", rotulo: "Empresas" },
            { href: "/admin/auditoria", rotulo: "Auditoria" },
            { href: "/admin/lgpd", rotulo: "LGPD" },
          ]}
        />
      </nav>
      {children}
    </div>
  );
}
