import type { Metadata } from "next";
import Link from "next/link";
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
        <Link href="/admin">Visão geral</Link>
        <Link href="/admin/usuarios">Usuários</Link>
        <Link href="/admin/empresas">Empresas</Link>
        <Link href="/admin/auditoria">Auditoria</Link>
      </nav>
      {children}
    </div>
  );
}
